"use strict";
const log = [];
const rows = JSON.parse('[' + Array.from({ length: 30 }, (_, i) => `{"id":${i},"price":${i + 0.5},"qty":${i % 4}}`).join() + ']');
rows.forEach((r, i) => { if (i % 5 === 4) Object.defineProperty(r, "price", { get() { return "asked " + i; }, enumerable: true, configurable: true }); });
function last(rows) { let kept; let s = 0; for (const r of rows) { s += r.qty; kept = r.price; } return s + ":" + typeof kept + ":" + String(kept); }
for (let turn = 0; turn < 4; turn++) log.push(last(rows));
console.log("SAID", log.join(" | "));
