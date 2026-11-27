"use strict";
const log = [];
const rows = JSON.parse('[' + Array.from({ length: 30 }, (_, i) => `{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"price":${i + 0.5},"h":8,"qty":${i % 4},"i":9}`).join() + ']');
function total(rows) { let s = 0; for (const r of rows) s += r.price * 10 + r.qty; return s; }
for (let turn = 0; turn < 4; turn++) log.push(total(rows));
console.log("SAID", log.join(" | "));
