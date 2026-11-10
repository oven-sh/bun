"use strict";
class Leaf { constructor(n) { this.tag = n; } }
const kept = [];
class Opened { constructor(o) { const tag = o.tag; if (o !== true) kept.push(tag); this.tag = tag; } }
const all = [];
for (let r = 0; r < 4; r++) all.push(new Opened(r & 1 ? new Leaf(r) : true));
let out = "";
for (const x of all) out += (x.tag === undefined ? "u" : x.tag) + ",";
console.log(out, kept.length);
