import "./b.mjs"; import "./reg.mjs";
var kept;
export function readLate() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; if (!kept) { kept = new Sub(work); return work; } return isSub(kept) + work; }
function isSub(x) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return (x instanceof Sub ? 10 : 20) + work; }
function Sub(a) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.a = a + work; }
Sub.prototype = {};
