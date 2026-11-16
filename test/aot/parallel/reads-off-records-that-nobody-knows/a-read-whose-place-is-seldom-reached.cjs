"use strict";
const log = [];
const rows = JSON.parse('[' + Array.from({ length: 30 }, (_, i) => `{"a":${i},"b":${i * 2}}`).join() + ']');
let asked = 0;
rows.forEach((r, i) => { if (i % 3 === 1) Object.defineProperty(r, "b", { get() { asked++; return 1000; }, enumerable: true, configurable: true }); });
function total(rows) { let s = 0; for (const r of rows) { const a = r.a; s += a; if (a > 24) s += r.b; } return s; }
for (let turn = 0; turn < 4; turn++) log.push(total(rows));
log.push(asked);
console.log("SAID", log.join(" | "));
