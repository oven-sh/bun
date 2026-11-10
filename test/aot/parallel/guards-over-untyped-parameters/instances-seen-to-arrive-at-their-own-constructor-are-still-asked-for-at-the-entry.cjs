"use strict";
class Vec { constructor(o) { this.x = o.x; this.y = o.y; } clone() { return new Vec(this); } }
const first = new Vec({ x: 1, y: 2 });
function spin(v) { for (let i = 0; i < 40; i++) v = v.clone(); return v; }
for (let t = 0; t < 300; t++) spin(first);
const last = spin(first);
console.log(last.x, last.y, last instanceof Vec, last !== first);
