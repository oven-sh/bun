"use strict";
const log = [];
const rows = JSON.parse('[{"price":1,"qty":2},[9,8],{"price":3,"qty":4}]');
rows[1].price = 5; rows[1].qty = 6;
const f = function () {}; f.price = 7; f.qty = 8; rows.push(f, new Map(), new Date(0));
rows[4].price = 9; rows[4].qty = 1; rows[5].qty = 2; rows[5].price = 3;
function total(rows) { let s = 0; for (const r of rows) s += r.price * 10 + r.qty; return s; }
for (let turn = 0; turn < 4; turn++) log.push(total(rows));
console.log("SAID", log.join(" | "));
