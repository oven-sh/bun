// A version of a loop learns at its first visit that a carried object is not merged, and remembers it at the next.
const keep = [];
class V { constructor(x, y) { this.x = x; this.y = y; } }
let box = null;
const at = o => o.x + "_" + o.y;
function carried(n, a) { let p = new V(0.5, 0); let q = new V(5, 6); for (let z = 0; z < 2; z++) { p = new V(p.x, z); for (let i = 0; i < n; i++) { if (i === 3) q = p = new V(7, i); if (p.x > 5) { keep.push(p); break; } p = new V(p.y, p.x); } } keep.push(p); q.x += 0.5; keep.push(p === q, p.x, q.x); return p; }
function boxed(n, a) { let p = new V(0.5, a); box = p; const q = box; for (const i of [1, 2, 3, 4]) { if (p.x > 5) { keep.push(p); break; } p = i & 1 ? new V(p.x, i) : p; } if (n > 2) p.x = 77; q.x += 0.5; keep.push(p === q, p.x, q.x, box === p, box === q, at(box)); return p; }
for (let turn = 0; turn < 3; turn++) for (const n of [0, 1, 2, 3, 6]) for (const a of [0, 1, 2.5]) { console.log(n, a, at(carried(n, a)), at(boxed(n, a)), keep.map(o => o && typeof o === "object" ? at(o) : String(o)).join(" ")); keep.length = 0; }
