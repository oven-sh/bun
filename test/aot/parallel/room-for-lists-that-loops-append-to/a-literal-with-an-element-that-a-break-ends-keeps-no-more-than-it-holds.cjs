"use strict";
function breaks(first, n, at) { const got = [first]; for (let j = 1; j <= n; j++) { got[j] = j; if (j === at) break; } return got; }

const count = 200000;
const kept = [];
Bun.gc(true);
const before = process.memoryUsage().heapUsed;
for (let r = 0; r < count; r++) kept.push(breaks(r, 1000 + (r & 7), 1 + (r & 1)));
Bun.gc(true);
const each = (process.memoryUsage().heapUsed - before) / count;
let held = 0; for (let r = 0; r < count; r++) held += kept[r].length;
console.log(each < 150 ? "little is kept a list" : "MUCH IS KEPT A LIST", held / count);
