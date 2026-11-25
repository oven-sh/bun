class Base { hello() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work; } }
function Sub() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.a = work; }
function read(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.hello; }
let first = "", early = "", late = "";
for (let i = 0; i < 300; i++) first = typeof read(new Base());
for (let i = 0; i < 300; i++) early = typeof read(new Sub());
Object.setPrototypeOf(Sub.prototype, Base.prototype);
for (let i = 0; i < 300; i++) late = typeof read(new Sub());
console.log(first, early, late);
