// The minified runtime of webpack: names that getters define, and what may stand in their way.
var out = [], lates = [], set = (o, v) => { o.a = v; return o.a; }, remove = o => delete o.a;
var show = f => { try { var v = f(); return typeof v === "function" ? "function " + v.name : typeof v === "object" && v ? JSON.stringify(v) : String(v); } catch (e) { return e.constructor.name + ": " + e.message; } };
(()=>{var e={12:(e,t,i)=>{"use strict";i.r(t),i.d(t,{Vector:()=>n,Zero:()=>r,count:()=>s,default:()=>o});var r=()=>new n,s=0;class n{constructor(e=0,t=0){this.x=e,this.y=t,s++}add(e){return new n(this.x+e.x,this.y+e.y)}}let o="later";lates.push(()=>(o="changed",s))},
13:(e,t,i)=>{"use strict";i.d(t,{a:()=>n}),i.d(t,{a:()=>"second",b:()=>"b"});const n="first";t.c="own",i.d(t,{c:()=>"never"})},
14:(e,t,i)=>{"use strict";t.z=1;i.d(t,{z:()=>2,constructor:()=>"its constructor",toString:()=>()=>"its text","a b":()=>3,7:()=>7})},
15:(e,t,i)=>{"use strict";Object.freeze(t),out.push(show(()=>i.d(t,{a:()=>1})),show(()=>t.a))},
16:(e,t,i)=>{"use strict";i.r(t),i.d(t,{__esModule:()=>"getter",early:()=>n});out.push(show(()=>n),String(t.__esModule),show(()=>i(17).back));const n=16},
17:(e,t,i)=>{"use strict";i.r(t),i.d(t,{back:()=>r});var n=i(16);const r=show(()=>n.early);lates.push(()=>n.early)},
18:e=>{e.exports=Object.freeze({get a(){return"of a frozen object"},[Symbol.for("s")]:1})},
19:(e,t,i)=>{"use strict";i.d(t,Object.create({inherited:()=>1},{own:{value:()=>"own",enumerable:!0}})),i.d(t,{get got(){return out.push("read"),()=>"got"}}),out.push(Object.keys(t).join(),t.own,t.got)},
20:(e,t,i)=>{"use strict";var n=i.n(i(12)),r=i.n(i(18));out.push(show(n),show(n.a===void 0?()=>0:()=>n.a),show(()=>r().a),show(()=>r.a))}},t={};function i(n){var r=t[n];if(void 0!==r)return r.exports;var s=t[n]={exports:{}};return e[n](s,s.exports,i),s.exports}i.n=e=>{var t=e&&e.__esModule?()=>e.default:()=>e;return i.d(t,{a:t}),t},i.d=(e,t)=>{for(var n in t)i.o(t,n)&&!i.o(e,n)&&Object.defineProperty(e,n,{enumerable:!0,get:t[n]})},i.o=(e,t)=>Object.prototype.hasOwnProperty.call(e,t),i.r=e=>{"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})};var n={};(()=>{"use strict";i.r(n),i.d(n,{run:()=>s});var r=i(12);function s(){let e=r.Zero();for(let t=0;t<1e3;t++)e=e.add(new r.Vector(t,1));return e.x+","+e.y+" "+r.count}
out.push(s(),n.run(),Object.keys(n).join(),String(n),r.default);for(const e of lates.splice(0))out.push(show(e));out.push(r.default);
var o=i(13);out.push(o.a,o.b,o.c,Object.keys(o).join());var a=i(14);out.push(String(a.z),a.constructor,a.toString(),a["a b"]+"",a[7]+"",Object.keys(a).join());i(15);var l=i(16);out.push(String(l.early),String(l.__esModule),Object.keys(l).join());for(const e of lates.splice(0))out.push(show(e));
out.push(show(()=>i(18).a),show(()=>set(i(18),5)));i(19);i(20);
out.push(show(()=>set(o,"stored")),JSON.stringify(Object.getOwnPropertyDescriptor(o,"a")),show(()=>remove(o)),show(()=>Object.defineProperty(r,"count",{value:1})),show(()=>r.absent),String("Zero"in r),String(i.o(r,"Zero")),Object.prototype.toString.call(r));
})()})();
for (const line of out) console.log(line);
