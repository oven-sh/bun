class Base { hello() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work; } }
function Middle() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.m = work; }
function Sub() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.a = work; }
function read(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.hello; }
let out = [];
function all() { let t = ""; for (let i = 0; i < 300; i++) t = typeof read(new Base()) + " " + typeof read(new Middle()) + " " + typeof read(new Sub()); return t; }
out.push(all());
Object.setPrototypeOf(Sub.prototype, Middle.prototype);
out.push(all());
Object.setPrototypeOf(Middle.prototype, Base.prototype);
out.push(all());
console.log(out.join(" | "));
