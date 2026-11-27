"use strict";
const log = [];
const rows = JSON.parse('[{"price":1,"qty":2},{"price":3,"qty":4},{"price":5,"qty":6}]');
const asked = [];
rows[1] = new Proxy(rows[1], { get(t, k) { asked.push(String(k)); return t[k] * 2; } });
function total(rows) { let s = 0; for (const r of rows) s += r.price * 10 + r.qty; return s; }
for (let turn = 0; turn < 4; turn++) log.push(total(rows));
log.push(asked.join());
console.log("SAID", log.join(" | "));
