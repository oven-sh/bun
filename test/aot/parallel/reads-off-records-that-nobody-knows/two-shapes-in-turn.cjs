"use strict";
const log = [];
const rows = JSON.parse('[' + Array.from({ length: 60 }, (_, i) => { const k = i % 2; return `{${'"p' + k + '":0,'.repeat(1)}${k % 2 ? `"qty":${i % 4},"price":${i + 0.5}` : `"price":${i + 0.5},"qty":${i % 4}`}}`; }).join() + ']');
function total(rows) { let s = 0; for (const r of rows) s += r.price * 10 + r.qty; return s; }
for (let turn = 0; turn < 4; turn++) log.push(total(rows));
console.log("SAID", log.join(" | "));
