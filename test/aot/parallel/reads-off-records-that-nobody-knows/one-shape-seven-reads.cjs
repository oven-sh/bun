"use strict";
const log = [];
const rows = JSON.parse('[' + Array.from({ length: 30 }, (_, i) => `{"a":${i},"b":${i + 1},"c":${i + 2},"d":${i * 2}}`).join() + ']');
function total(rows) { let s = 0; for (const r of rows) s += r.a + r.b * 2 + r.c * 3 + r.d * 5 + r.a * 7 + r.b * 11 + r.c * 13 + r.d * 17 + r.a * 19; return s; }
for (let turn = 0; turn < 4; turn++) log.push(total(rows));
console.log("SAID", log.join(" | "));
