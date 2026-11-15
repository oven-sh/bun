// The same, and the statement that would lay the link is never run.
let seen = "nothing";
class Base { get size() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return "got"; } set size(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; seen = v; } }
function Sub() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.a = work; }
class Top extends Sub { put(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; super.size = v; return this; } }
function read(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.size; }
function kind(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof read(o); }
const unseen = (x) => [x][JSON.parse("0")];
if (unseen(false)) Object.setPrototypeOf(Sub.prototype, Base.prototype);
let out = ""; for (let i = 0; i < 300; i++) { const one = new Top().put(5); out = [read(one), kind(one), seen, Object.keys(one).join("+")].join(); }
console.log(out);
