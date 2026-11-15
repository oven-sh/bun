"use strict";
const log = [];
const rows = JSON.parse('[' + Array.from({ length: 140 }, (_, i) => i === 0 ? '[0]' : i < 40 ? '{}' : `{"id":${i + 100},"price":${i + 0.5},"qty":${i % 4}}`).join() + ']');
rows.forEach((r, i) => { if (i >= 40) return; if (i) for (let k = 0; k < 20; k++) r["k" + k] = k; r.price = i + 3; r.qty = 1; });
function total(rows) { let s = 0; for (const r of rows) s += r.price * 10 + r.qty; return s; }
for (let turn = 0; turn < 60; turn++) { const sum = total(rows); if (turn % 7 === 0 || sum !== log[log.length - 1]) log.push(sum); if (turn === 40) Bun.gc(true); }
console.log("SAID", log.join(" | "));
