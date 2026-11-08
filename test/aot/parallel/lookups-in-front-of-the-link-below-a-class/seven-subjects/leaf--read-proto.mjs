class Base { hello() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work; } }
function Sub() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.a = work; }
class Leaf extends Sub {}
function probe(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.__proto__.hello; }
let early = "", late = "";
for (let turn = 0; turn < 300; turn++) early = typeof probe(new Leaf());
Object.setPrototypeOf(Sub.prototype, Base.prototype);
for (let turn = 0; turn < 300; turn++) late = typeof probe(new Leaf());
console.log(early, late);
