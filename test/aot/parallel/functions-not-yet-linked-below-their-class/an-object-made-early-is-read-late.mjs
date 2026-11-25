class Base { hello() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work; } }
function Sub() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.a = work; }
function read(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.hello; }
const kept = new Sub();
let before = "", after = "";
for (let i = 0; i < 300; i++) before = typeof read(new Base()) + " " + typeof read(kept);
Object.setPrototypeOf(Sub.prototype, Base.prototype);
for (let i = 0; i < 300; i++) after = typeof read(new Base()) + " " + typeof read(kept);
console.log(before, "|", after);
