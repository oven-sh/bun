"use strict";
class Leaf { constructor(n) { this.tag = n; } }
const kept = [];
function told(x, deep) { return deep ? told(x, deep - 1) : x === undefined ? "u" : typeof x; }
function keep(v, d) { const tag = v.tag; if (v !== true) kept.push(tag); return told(tag, d); }
let out = "";
for (let r = 0; r < 4; r++) out += keep(r & 1 ? new Leaf(r) : true, JSON.parse("3")) + ",";
console.log(out, kept.length);
