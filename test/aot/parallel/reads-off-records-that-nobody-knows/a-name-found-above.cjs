"use strict";
const log = [];
const above = JSON.parse('{"qty":7}');
const rows = JSON.parse('[' + Array.from({ length: 30 }, (_, i) => i % 7 !== 6 ? `{"price":${i + 0.5},"qty":${i % 4}}` : `{"price":${i + 0.5}}`).join() + ']');
rows.forEach((r, i) => { if (i % 7 === 6) Object.setPrototypeOf(r, above); });
function total(rows) { let s = 0; for (const r of rows) s += r.price * 10 + r.qty; return s; }
for (let turn = 0; turn < 4; turn++) { log.push(total(rows)); above.qty = turn * 1000; }
console.log("SAID", log.join(" | "));
