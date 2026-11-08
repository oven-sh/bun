function Base(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.v = v; }
function Sub(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.v = v; this.s = work; }
Sub.prototype = Object.create(Base.prototype);
function maker(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.constructor; }
function markIt(C) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; C.mark = "text"; }
function markOf(f) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return f.mark; }
const first = new Base(1);
let other = "", out = "";
for (let i = 0; i < 300; i++) other = typeof maker({ tag: i });
for (let i = 0; i < 300; i++) markIt(maker(new Sub(i)));
for (let i = 0; i < 300; i++) out = typeof markOf(Base);
console.log(other, out, first.v);
