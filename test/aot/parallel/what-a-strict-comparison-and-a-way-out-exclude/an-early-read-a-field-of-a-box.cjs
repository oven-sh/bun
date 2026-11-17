"use strict";
class Leaf { constructor(n) { this.tag = n; } }
const kept = [];
class Box { constructor(n) { this.n = n; } }
const boxes = [];
function keep(v) { const tag = v.tag; if (v !== true) kept.push(tag); boxes.push(new Box(tag)); }
for (let r = 0; r < 4; r++) keep(r & 1 ? new Leaf(r) : true);
let out = "";
for (const b of boxes) out += (b.n === undefined ? "u" : b.n) + ",";
console.log(out, kept.length);
