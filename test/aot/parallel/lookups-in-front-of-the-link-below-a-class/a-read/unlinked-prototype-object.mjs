class Base { hello() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work; } }
function Sub() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.a = work; }
function read(p) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return p.hello; }
let early = "", late = "";
for (let i = 0; i < 300; i++) early = typeof read(Sub.prototype);
Object.setPrototypeOf(Sub.prototype, Base.prototype);
for (let i = 0; i < 300; i++) late = typeof read(Sub.prototype);
console.log(early, late, new Sub().a, new Base().hello());
