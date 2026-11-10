"use strict";
class Tag { constructor(k) { this.k = k; } twice() { return this.k * 2; } }
class Leaf { constructor(n) { this.n = n; this.tag = new Tag(n); } }
const inputs = [new Leaf(3), true, new Leaf(5)];
const held = [];
function pick(x) { if (x === true) { held.push(undefined); return 1; } const tag = x.tag; held.push(tag); return tag.k; }
function tell(list) { let s = ""; for (let i = 0; i < list.length; i++) { const e = list[i]; s += e === undefined ? "none," : e.twice() + ","; } return s; }
let seen = 0;
for (let turn = 0; turn < Number(process.argv[2] || 9); turn++) seen += pick(inputs[turn % 3]);
console.log(tell(held), seen);
