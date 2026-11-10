"use strict";
const log = [];
const rows = JSON.parse('[' + Array.from({ length: 70 }, (_, i) => i === 10 ? '{}' : i < 10 ? `{"id":${i + 100},"price":${i + 0.5},"qty":${i % 4}}` : `{"qty":${i % 4},"id":${i + 100},"price":${i + 0.5}}`).join() + ']');
for (let k = 0; k < 100; k++) rows[10]["k" + k] = k;
rows[10].price = 3; rows[10].qty = 1;
function total(rows) { let s = 0; for (const r of rows) s += r.price * 10 + r.qty; return s; }
for (let turn = 0; turn < 8; turn++) { log.push(total(rows)); if (turn % 2) Bun.gc(true); }
console.log("SAID", log.join(" | "));
