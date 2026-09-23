const crypto=require("crypto");
const path=require("path");
const http=require("http");
const express=require("express");
const {WebSocketServer}=require("ws");
const app=express(), server=http.createServer(app);
const wss=new WebSocketServer({server});
app.use(express.static(path.join(__dirname,"public")));
const rooms=new Map();
const uid=()=>crypto.randomUUID();
const code=()=>Math.random().toString(36).slice(2,8).toUpperCase();
const send=(w,m)=>w&&w.readyState===1&&w.send(JSON.stringify(m));
function broadcast(r,m){r.players.forEach(p=>send(p.ws,m))}
function state(r){return {code:r.code,dealer:r.dealer,started:r.started,street:r.street,pot:r.pot,community:r.community,players:r.players.map(p=>({id:p.id,name:p.name,chips:p.chips,bet:p.bet,folded:p.folded,allIn:p.allIn,connected:!!p.ws}))}}
function newRoom(){let c;do c=code();while(rooms.has(c));let r={code:c,dealer:null,started:false,street:"preflop",pot:0,community:[],players:[],deck:[]};rooms.set(c,r);return r}
function deck(){return ["♠","♥","♦","♣"].flatMap(s=>["2","3","4","5","6","7","8","9","T","J","Q","K","A"].map(v=>({r:v,s})))} 
function shuffle(a){for(let i=a.length-1;i;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function bet(r,p,n){n=Math.max(0,Math.min(n,p.chips));p.chips-=n;p.bet+=n;r.pot+=n;if(!p.chips)p.allIn=true}
function start(r){if(r.started||r.players.length<2)return;r.started=true;r.deck=shuffle(deck());r.community=[];r.pot=0;r.street="preflop";r.players.forEach(p=>{p.bet=0;p.folded=false;p.allIn=false;p.hand=[r.deck.pop(),r.deck.pop()]});let i=r.players.findIndex(p=>p.id===r.dealer);bet(r,r.players[(i+1)%r.players.length],10);bet(r,r.players[(i+2)%r.players.length],20);broadcast(r,{type:"state",state:state(r)})}
function next(r){r.players.forEach(p=>p.bet=0);if(r.street==="preflop"){r.community.push(r.deck.pop(),r.deck.pop(),r.deck.pop());r.street="flop"}else if(r.street==="flop"){r.community.push(r.deck.pop());r.street="turn"}else if(r.street==="turn"){r.community.push(r.deck.pop());r.street="river"}else{let a=r.players.filter(p=>!p.folded);if(a.length)a[0].chips+=r.pot;r.pot=0;r.started=false;r.community=[];r.street="preflop";broadcast(r,{type:"state",state:state(r),showdown:true});return}broadcast(r,{type:"state",state:state(r)})}
function check(r){let a=r.players.filter(p=>!p.folded);if(a.length<=1){nextToEnd(r);return}let m=Math.max(...a.map(p=>p.bet));if(a.every(p=>p.allIn||p.bet===m))next(r);else broadcast(r,{type:"state",state:state(r)})}
function nextToEnd(r){let a=r.players.find(p=>!p.folded);if(a){a.chips+=r.pot;r.pot=0}r.started=false;r.community=[];r.street="preflop";broadcast(r,{type:"state",state:state(r)})}
wss.on("connection",ws=>ws.on("message",raw=>{let m;try{m=JSON.parse(raw)}catch{return}
if(m.type==="create"){let r=newRoom(),p={id:uid(),name:m.name||"Crupier",chips:1000,bet:0,folded:false,allIn:false,ws,hand:[]};r.players.push(p);r.dealer=p.id;ws.room=r.code;ws.pid=p.id;send(ws,{type:"created",code:r.code,playerId:p.id,state:state(r)});return}
if(m.type==="join"){let r=rooms.get(String(m.code||"").toUpperCase());if(!r)return send(ws,{type:"error",message:"Sala no encontrada"});if(r.players.length>=10)return send(ws,{type:"error",message:"Sala llena"});let p={id:uid(),name:m.name||"Jugador",chips:1000,bet:0,folded:false,allIn:false,ws,hand:[]};r.players.push(p);ws.room=r.code;ws.pid=p.id;send(ws,{type:"joined",code:r.code,playerId:p.id,state:state(r)});broadcast(r,{type:"state",state:state(r)});return}
let r=rooms.get(ws.room),p=r&&r.players.find(x=>x.id===ws.pid);if(!r||!p)return;
if(m.type==="start"&&p.id===r.dealer)start(r);
if(m.type==="newhand"&&p.id===r.dealer&&!r.started)start(r);
if(m.type==="dealer_next"&&p.id===r.dealer&&r.started)next(r);
if(m.type==="fold"&&r.started&&!p.folded){p.folded=true;check(r)}
if(m.type==="call"&&r.started&&!p.folded){let mx=Math.max(...r.players.map(x=>x.bet));bet(r,p,mx-p.bet);check(r)}
if(m.type==="bet"&&r.started&&!p.folded){bet(r,p,Number(m.amount)||0);check(r)}
if(m.type==="chat")broadcast(r,{type:"chat",name:p.name,text:String(m.text||"").slice(0,300)})}));
wss.on("connection",ws=>ws.on("close",()=>{let r=rooms.get(ws.room);if(r){let p=r.players.find(x=>x.id===ws.pid);if(p)p.ws=null;broadcast(r,{type:"state",state:state(r)})}}));
server.listen(process.env.PORT||3000);
