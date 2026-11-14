"use strict";
const log = [];
const rows = JSON.parse('[' + Array.from({ length: 30 }, (_, i) => `{"id":${i},"price":${i + 0.5},"qty":${i % 4}}`).join() + ']');
let asked = 0;
rows.forEach((r, i) => { if (i % 2) Object.defineProperty(r, "price", { get() { asked++; return i * 100; }, enumerable: true, configurable: true }); });
function total(rows) { let s = 0; for (const r of rows) s += r.price * 10 + r.qty; return s; }
for (let turn = 0; turn < 4; turn++) log.push(total(rows));
log.push(asked);
console.log("SAID", log.join(" | "));
