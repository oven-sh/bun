"use strict";
const log = [];
const rows = JSON.parse('[' + Array.from({ length: 30 }, (_, i) => i % 2 ? `{"id":${i},"price":${i + 0.5},"qty":${i % 4}}` : `{"qty":${i % 4},"price":${i + 0.5}}`).join() + ']');
function total(rows) { let s = 0; for (let i = 1; i < rows.length; i++) { const a = rows[i - 1], b = rows[i]; s += a.price * 10 + b.qty + b.price * 100 + a.qty * 1000; } return s; }
for (let turn = 0; turn < 4; turn++) log.push(total(rows));
console.log("SAID", log.join(" | "));
