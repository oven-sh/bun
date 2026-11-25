import "./b.mjs"; import "./reg.mjs";
export function readLate() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return kindOf(new Sub(work)) + work; }
function kindOf(x) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return (x instanceof Base ? 10 : 20) + work; }
function Base(a) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.a = a + work; }
function Sub(a) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; Base.call(this, a); }
Sub.prototype = Object.create(Base.prototype);
