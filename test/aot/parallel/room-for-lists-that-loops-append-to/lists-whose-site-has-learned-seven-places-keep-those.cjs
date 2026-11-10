"use strict";
function breaks(n, at) { const got = []; for (let j = 0; j < n; j++) { got.push(j); if (j === at) break; } return got; }

const count = 200000;
const kept = [];
Bun.gc(true);
const before = process.memoryUsage().heapUsed;
for (let r = 0; r < count; r++) kept.push(breaks(8 + (r & 1023), 6));
Bun.gc(true);
const each = (process.memoryUsage().heapUsed - before) / count;
let held = 0; for (let r = 0; r < count; r++) held += kept[r].length;
console.log(each < 200 ? "little is kept a list" : "MUCH IS KEPT A LIST", held / count);
