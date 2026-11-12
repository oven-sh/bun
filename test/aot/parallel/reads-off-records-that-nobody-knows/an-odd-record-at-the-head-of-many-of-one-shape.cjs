"use strict";
const log = [];
const rows = JSON.parse('[{},' + Array.from({ length: 60 }, (_, i) => `{"id":${i + 100},"price":${i + 0.5},"qty":${i % 4}}`).join() + ']');
for (let k = 0; k < 100; k++) rows[0]["k" + k] = k;
rows[0].price = 3; rows[0].qty = 1;
function total(rows) { let s = 0; for (const r of rows) s += r.price * 10 + r.qty; return s; }
for (let turn = 0; turn < 8; turn++) { log.push(total(rows)); if (turn % 2) Bun.gc(true); }
console.log("SAID", log.join(" | "));
