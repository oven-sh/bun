"use strict";
const log = [];
const rows = JSON.parse('[' + Array.from({ length: 30 }, (_, i) => i % 2 ? `{"id":${i},"price":${i + 0.5},"qty":${i % 4}}` : `{"qty":${i % 4},"price":${i + 0.5}}`).join() + ']');
for (let turn = 0; turn < 4; turn++) { let s = 0; for (const r of rows) s += r.price * 10 + r.qty; log.push(s); }
console.log("SAID", log.join(" | "));
