class Base { set level(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; } }
function Sub() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.a = work; }
function put(o, v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; o.level = v; }
function read(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.level; }
const early = new Sub();
for (let i = 0; i < 300; i++) put(early, 5);
Object.setPrototypeOf(Sub.prototype, Base.prototype);
let kind = "";
for (let i = 0; i < 300; i++) kind = typeof read(early);
console.log(kind);
