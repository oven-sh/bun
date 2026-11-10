// STATISTIC: ClampedCapacitiesReserved >= 1
"use strict";
// What a push needs is the elements that the list has and the turns that are left, not the bound.
function take(l, from, to) { const got = [from]; for (let j = from; j < to; j++) got.push(l[j] + 1); return got; }
const l = []; for (let k = 0; k < 48; k++) l.push(k * k);
function one(r) { const to = 40 + (r & 3); return take(l, to - 1, to); }

const count = 200000;
const kept = [];
Bun.gc(true);
const before = process.memoryUsage().heapUsed;
for (let r = 0; r < count; r++) kept.push(one(r));
Bun.gc(true);
const each = (process.memoryUsage().heapUsed - before) / count;
let held = 0; for (let r = 0; r < count; r++) held += kept[r].length;
console.log(each < 150 ? "little is kept a list" : "MUCH IS KEPT A LIST", held / count);
