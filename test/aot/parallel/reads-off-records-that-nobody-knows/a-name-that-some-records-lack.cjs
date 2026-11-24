"use strict";
const log = [];
const rows = JSON.parse('[' + Array.from({ length: 30 }, (_, i) => i % 7 !== 6 ? `{"price":${i + 0.5},"qty":${i % 4}}` : `{"price":${i + 0.5}}`).join() + ']');
function total(rows) { let s = 0; for (const r of rows) s += r.price * 10 + (r.qty ?? 100); return s; }
for (let turn = 0; turn < 4; turn++) log.push(total(rows));
console.log("SAID", log.join(" | "));
