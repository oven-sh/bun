"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
class Leaf { constructor(v) { this.v = v; } read() { return this.v; } }
let sum = 0;
for (let turn = 0; turn < 8 + more; turn++) { let held = []; for (let i = 0; i < 200; i++) { const above = { read() { return i + turn; }, tag: "t" + (i % 5) }; const leaf = new Leaf(i); if (i % 2) Object.setPrototypeOf(leaf, above); if (i % 4 === 1) leaf["own" + (i % 9)] = turn; held.push(leaf); } for (const leaf of held) sum = (sum * 31 + leaf.read() + (leaf.tag ? leaf.tag.length : 0) + Object.keys(leaf).length) % 1000003; held = null; Bun.gc(turn % 3 === 0); const churn = []; for (let i = 0; i < 20000; i++) churn.push([i]); said.push(String(sum), String(churn.length)); }
console.log(said.join("\n"));
