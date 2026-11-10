"use strict";
const log = [];
const text = '[' + Array.from({ length: 30 }, (_, i) => `{"price":${i + 0.5},"qty":${i % 4},"id":${i}}`).join() + ']';
function made() { const rows = JSON.parse(text); rows.forEach((r, i) => { if (i % 3 === 1) Object.defineProperty(r, "price", { get() { const q = this.qty; delete this.qty; delete this.id; this.id = 500; this.qty = q + 1; return i; }, configurable: true }); }); return rows; }
function total(rows) { let s = 0; for (const r of rows) s += r.price * 10 + r.qty + r.id; return s; }
for (let turn = 0; turn < 4; turn++) log.push(total(made()));
console.log("SAID", log.join(" | "));
