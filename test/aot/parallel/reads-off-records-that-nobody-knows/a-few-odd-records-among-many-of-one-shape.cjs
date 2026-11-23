"use strict";
const log = [];
const rows = JSON.parse('[' + Array.from({ length: 400 }, (_, i) => `{"id":${i},"price":${(i * 7) % 97},"qty":${i % 7}}`).join() + ']');
for (let i = 20; i < 400; i += 40) { const r = rows[i]; for (let k = 0; k < 80; k++) r["k" + k] = k; for (let k = 0; k < 80; k++) delete r["k" + k]; }
function total(rows) { let s = 0; for (const r of rows) s += r.price * 10 + r.qty; return s; }
for (let turn = 0; turn < 120; turn++) { const s = total(rows); if (turn % 20 === 19) log.push(s); }
console.log("SAID", log.join(" | "));
