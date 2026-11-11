"use strict";
const log = [];
const rows = JSON.parse('[' + Array.from({ length: 121 }, (_, i) => i === 0 ? '[0]' : i <= 60 ? `{"first":${i},"price":${i + 0.5},"qty":${i % 4}}` : `{"second":${i * 2},"qty":${i % 3},"tag":${i},"price":${i + 0.25}}`).join() + ']');
rows[0].price = 3; rows[0].qty = 1;
function total(rows) { let s = 0; for (const r of rows) s += r.price * 10 + r.qty; return s; }
for (let turn = 0; turn < 60; turn++) { const sum = total(rows); if (turn % 7 === 0 || sum !== log[log.length - 1]) log.push(sum); if (turn === 40) Bun.gc(true); }
console.log("SAID", log.join(" | "));
