"use strict";
// Every third record answers `price` by a getter: the tables by name hold an accessor for its shape: it is no value to hand over: the getter runs, once for each read, in the order of the list.
const size = Number(process.env.SIZE ?? 300);
const rows = JSON.parse("[" + Array.from({ length: size }, (_, i) => '{"price":' + i + ',"count":2}').join(",") + "]");
let asked = 0, order = 0;
for (let i = 0; i < size; i += 3) { const price = rows[i].price; Object.defineProperty(rows[i], "price", { get() { asked++; order = (order * 31 + i) % 1000003; return price + 1; }, enumerable: true, configurable: true }); }
function total(rows) { let sum = 0; for (const row of rows) sum += row.price * row.count; return sum; }
let all = 0;
for (let turn = 0; turn < 200; turn++) all = (all + total(rows)) % 1000003;
console.log(all, asked, order);
