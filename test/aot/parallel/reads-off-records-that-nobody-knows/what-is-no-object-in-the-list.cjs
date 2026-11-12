"use strict";
const log = [];
const rows = JSON.parse('[' + Array.from({ length: 12 }, (_, i) => `{"price":${i + 1},"qty":${i % 4}}`).join() + ',5,"text",true,0.5,{"qty":1,"price":2}]');
function total(rows) { let s = 0; for (const r of rows) s = (s * 31) % 1000003 + ((r.price * 10 + r.qty) || 7); return s; }
for (let turn = 0; turn < 4; turn++) log.push(total(rows));
console.log("SAID", log.join(" | "));
