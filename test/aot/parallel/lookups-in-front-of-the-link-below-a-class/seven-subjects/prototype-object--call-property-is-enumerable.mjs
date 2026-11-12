class Base { propertyIsEnumerable() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return 7 + work; } }
function Sub() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.a = work; }
function probe(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.propertyIsEnumerable("a"); }
let early = "", late = "";
for (let turn = 0; turn < 300; turn++) early = typeof probe(Sub.prototype);
Object.setPrototypeOf(Sub.prototype, Base.prototype);
for (let turn = 0; turn < 300; turn++) late = typeof probe(Sub.prototype);
console.log(early, late);
