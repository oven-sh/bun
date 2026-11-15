"use strict";
const log = [];
function total(rows) { let s = 0; for (const r of rows) s += r.price * 10 + r.qty; return s; }
for (let round = 0; round < 60; round++) {
  let rows = JSON.parse('[' + Array.from({ length: 8 }, (_, i) => round % 2 ? `{"u${round}":0,"price":${i + 1},"qty":2}` : `{"u${round}":0,"qty":2,"price":${i + 1}}`).join() + ']');
  log.push(total(rows));
  rows = null;
  Bun.gc(true);
}
console.log("SAID", log.join(" | "));
