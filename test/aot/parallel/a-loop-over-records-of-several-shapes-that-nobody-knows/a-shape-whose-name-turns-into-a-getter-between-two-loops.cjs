"use strict";
// The tables by name hold an own value for both shapes; then the name of one record of the second shape is defined anew as a getter, and of another is deleted and added again: both are other shapes from then on.
const size = Number(process.env.SIZE ?? 300);
const rows = JSON.parse("[" + Array.from({ length: size }, (_, i) => (i % 2 ? '{"kind":1,' : "{") + '"price":' + i + ',"count":2}').join(",") + "]");
function total(rows) { let sum = 0; for (const row of rows) sum += row.price * row.count; return sum; }
let all = 0;
for (let turn = 0; turn < 200; turn++) all = (all + total(rows)) % 1000003;
let asked = 0;
Object.defineProperty(rows[1], "price", { get() { asked++; return 5000; }, enumerable: true, configurable: true });
delete rows[3].price; rows[3].late = 7; rows[3].price = 6000;
Object.freeze(rows[5]);
rows[7].price = "8";
for (let turn = 0; turn < 200; turn++) all = (all + total(rows)) % 1000003;
console.log(all, asked);
