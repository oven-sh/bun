let taken = 0;
class Base { set level(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; taken += v; } }
function Middle() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.m = work; }
function Sub() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.a = work; }
function put(o, v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; o.level = v; }
function read(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.level; }
const first = new Sub();
for (let i = 0; i < 300; i++) put(first, 5);
Object.setPrototypeOf(Sub.prototype, Middle.prototype);
const second = new Sub();
for (let i = 0; i < 300; i++) put(second, 6);
Object.setPrototypeOf(Middle.prototype, Base.prototype);
const third = new Sub();
for (let i = 0; i < 300; i++) put(third, 7);
console.log(read(first), read(second), read(third), taken);
