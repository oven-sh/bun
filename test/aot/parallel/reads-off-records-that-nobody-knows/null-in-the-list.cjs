"use strict";
const log = [];
const rows = JSON.parse('[' + Array.from({ length: 12 }, (_, i) => i === 9 ? 'null' : `{"price":${i + 1},"qty":${i % 4}}`).join() + ']');
function total(rows, upTo) { let s = 0; for (let i = 0; i < upTo; i++) { const r = rows[i]; s += r.price * 10 + r.qty; } return s; }
for (let turn = 0; turn < 4; turn++) { log.push(total(rows, 9)); try { log.push(total(rows, 12)); } catch (e) { log.push(e instanceof TypeError); } }
console.log("SAID", log.join(" | "));
