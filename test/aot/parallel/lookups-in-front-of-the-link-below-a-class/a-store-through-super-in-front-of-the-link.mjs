// `super.size = v` in a class below the function: in front of the link no setter is found, so the property is laid on the receiver, and hides the accessor from then on.
let seen = "nothing";
class Base { get size() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return "got"; } set size(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; seen = v; } }
function Sub() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.a = work; }
class Top extends Sub { put(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; super.size = v; return this; } }
function read(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.size; }
function kind(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof read(o); }
let early;
for (let i = 0; i < 300; i++) early = new Top().put(5);
Object.setPrototypeOf(Sub.prototype, Base.prototype);
let late;
for (let i = 0; i < 300; i++) late = new Top().put(6);
let out = ""; for (let i = 0; i < 300; i++) out = [read(early), kind(early), read(late), kind(late), seen, Object.keys(early).join("+"), Object.keys(late).join("+")].join();
console.log(out);
