"use strict";
const log = [];
const lists = JSON.parse('[' + Array.from({ length: 1500 }, (_, i) => `[${i}]`).join() + ']');
lists.forEach((r, i) => { r.price = i % 97; r.qty = i % 7; });
const rows = JSON.parse('[' + Array.from({ length: 30 }, (_, i) => `{"id":${i},"price":${i + 0.5},"qty":${i % 4}}`).join() + ']');
function total(rows) { let s = 0; for (const r of rows) s += r.price * 10 + r.qty; return s; }
log.push(total(rows), total(rows));
for (let turn = 0; turn < 5; turn++) log.push(total(lists));
log.push(total(rows), total(rows));
Bun.gc(true);
log.push(total(rows), total(rows), total(rows));
console.log("SAID", log.join(" | "));
