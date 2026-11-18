function Base(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.v = v; }
function Sub(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.v = v; this.s = work; }
Sub.prototype = Object.create(Base.prototype);
function maker(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.constructor; }
function hello() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work; }
function lay(C, f) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; C.prototype.hello = f; }
function read(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.hello; }
let other = "", out = "";
for (let i = 0; i < 300; i++) other = typeof maker({ tag: i });
for (let i = 0; i < 300; i++) lay(maker(new Sub(i)), hello);
for (let i = 0; i < 300; i++) out = typeof read(new Base(i));
console.log(other, out);
