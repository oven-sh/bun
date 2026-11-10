"use strict";
// The bound is about a thousand and a break ends the loop at its second or third turn. Whoever gives such a list room by its bound, or by a constant, keeps that room for as long as the list lives.
function breaks(n, at) { const got = []; for (let j = 0; j < n; j++) { got.push(j); if (j === at) break; } return got; }

const count = 200000;
const kept = [];
Bun.gc(true);
const before = process.memoryUsage().heapUsed;
for (let r = 0; r < count; r++) kept.push(breaks(1000 + (r & 7), 1 + (r & 1)));
Bun.gc(true);
const each = (process.memoryUsage().heapUsed - before) / count;
let held = 0; for (let r = 0; r < count; r++) held += kept[r].length;
console.log(each < 150 ? "little is kept a list" : "MUCH IS KEPT A LIST", held / count);
