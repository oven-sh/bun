"use strict";
function Knot(tag, above) { this.tag = tag; this.flags = 0; this.size = above; this.twin = null; this.held = null; }
const cursor = { current: null };
function climb(start) {
  let found = 0;
  for (var knot = start; null !== knot; ) {
    if (10 === knot.tag) { if (null !== knot.twin) found += 2; else found += 3; }
    else if (knot === cursor.current) found += 1;
    knot = knot.size;
    if ("object" !== typeof knot) break;
  }
  return found;
}
const table = { climb }, key = ["cli", "mb"].join("");
let top = null; for (let i = 0; i < 60; i++) top = new Knot(i % 12, top);
cursor.current = top;
const parsed = JSON.parse('{ "tag": 10, "twin": 1 }'); parsed[["size"].join("")] = top;
const others = [parsed, new Map([[1, 2]]), new Set()];
let said = new Map([[1, 2]]).size;
for (let turn = 0; turn < 3000; turn++) said = (said + (turn % 500 === 499 ? table[key](others[(turn / 500 | 0) % others.length]) : climb(top))) % 1000003;
console.log(said);
