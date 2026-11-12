"use strict";
class Leaf { constructor(n) { this.tag = n; } }
const kept = [];
function keep(v) { const tag = v.tag; if (v !== true) kept.push(tag); return () => typeof tag; }
const fs = [];
for (let r = 0; r < 4; r++) fs.push(keep(r & 1 ? new Leaf(r) : true));
console.log(fs.map(f => f()).join(), kept.length);
