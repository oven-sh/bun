class Base { toLocaleString() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return 7 + work; } }
function Sub() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.a = work; }
function Sub2() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.b = work; }
function probe(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.toLocaleString(); }
let early = "", late = "";
for (let turn = 0; turn < 300; turn++) early = typeof probe((turn & 1 ? Sub.prototype : Sub2.prototype));
Object.setPrototypeOf(Sub.prototype, Base.prototype);
Object.setPrototypeOf(Sub2.prototype, Base.prototype);
for (let turn = 0; turn < 300; turn++) late = typeof probe((turn & 1 ? Sub.prototype : Sub2.prototype));
console.log(early, late);
