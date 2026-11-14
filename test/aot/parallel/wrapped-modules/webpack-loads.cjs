// webpack's loads of a module in a later turn: `Promise.resolve().then(require.bind(require, id))`.
var out = [];
var show = f => { try { var v = f(); return typeof v === "function" ? "function " + v.name : typeof v === "object" && v ? JSON.stringify(v) : String(v); } catch (e) { return e.constructor.name + ": " + e.message; } };
(()=>{var e={21:(e,t,i)=>{"use strict";i.r(t),i.d(t,{Shader:()=>r,count:()=>n});out.push("21 runs");let n=0;class r{constructor(e){this.name=e,n++}get length(){return this.name.length}}},
22:(e,t,i)=>{"use strict";i.r(t),i.d(t,{default:()=>r,late:()=>s});out.push("22 runs");var n=i(21);const r=new n.Shader("of 22");async function s(){const{Shader:e}=await Promise.resolve().then(i.bind(i,21));return new e("late").length+" "+(await Promise.resolve().then(i.bind(i,22))).default.name}},
23:e=>{out.push("23 runs"),e.exports=function(e){return e*23}},
24:(e,t)=>{out.push("24 runs"),t.before=1;if(out.length)throw new Error("24 throws");t.after=2},
25:(e,t,i)=>{out.push("25 runs"),t.load=e=>e?Promise.resolve().then(i.bind(i,26)):Promise.resolve().then(i.bind(i,"27"))},
26:(e,t,i)=>{"use strict";i.r(t),i.d(t,{own:()=>n}),out.push("26 runs");const n=[26]},
27:(e,t)=>{out.push("27 runs"),t.own=27},
28:(e,t)=>{out.push("28 never runs"),t.never=1}},t={};function i(n){var r=t[n];if(void 0!==r)return r.exports;var s=t[n]={exports:{}};return e[n](s,s.exports,i),s.exports}i.d=(e,t)=>{for(var n in t)i.o(t,n)&&!i.o(e,n)&&Object.defineProperty(e,n,{enumerable:!0,get:t[n]})},i.o=(e,t)=>Object.prototype.hasOwnProperty.call(e,t),i.r=e=>{"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})};
(async()=>{var n=Promise.resolve().then(i.bind(i,22));out.push("in the same turn");var r=await n;out.push(show(()=>r.default),await r.late(),Object.keys(r).join(),String(r));
out.push(String((await Promise.resolve().then(i.bind(i,23)))(2)),String(i(23)===await Promise.resolve().then(i.bind(i,23))));
for(let e=0;e<2;e++)await Promise.resolve().then(i.bind(i,24)).then(e=>out.push(show(()=>e.before),show(()=>e.after)),e=>out.push(e.message));
var s=i(25);out.push(show(()=>s.load),JSON.stringify((await s.load(1)).own),String((await s.load(0)).own));
await Promise.all([Promise.resolve().then(i.bind(i,26)),Promise.resolve().then(i.bind(i,21))]).then(([e,t])=>out.push(e.own+" "+t.count+" "+new t.Shader("x").length+" "+t.count));
Promise.resolve(5).then(i.bind(i,27)).then(e=>{e.own=28});await null;await null;await null;out.push(String(i(27).own));
globalThis.never&&Promise.resolve().then(i.bind(i,28));
switch(await Promise.resolve().then(i.bind(i,23)),out.length){case 0:out.push("empty");break;default:out.push("switched")}
var o={then(e){out.push(typeof e,String(e.length),String(e()===i(26)));return o}};o.then(i.bind(i,26));
console.log(out.join("\n"))})()})();
