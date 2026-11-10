"use strict";
function word(text) { const got = []; for (let j = 0; j < text.length; j++) { const c = text.charCodeAt(j); if (c === 32) break; got.push(c); } return got; }

const count = 200000;
const kept = [];
Bun.gc(true);
const before = process.memoryUsage().heapUsed;
for (let r = 0; r < count; r++) kept.push(word(r & 1 ? "ab cdefghijklmnopqrstuvwxyz0123456789" : "abc defghijklmnopqrstuvwxyz0123456789"));
Bun.gc(true);
const each = (process.memoryUsage().heapUsed - before) / count;
let held = 0; for (let r = 0; r < count; r++) held += kept[r].length;
console.log(each < 150 ? "little is kept a list" : "MUCH IS KEPT A LIST", held / count);
