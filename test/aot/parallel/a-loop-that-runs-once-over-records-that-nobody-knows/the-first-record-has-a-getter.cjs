"use strict";
// The look that fills the site meets an accessor: it must not hand over the accessor nor run it: the general read runs it, once for each read as written.
const size = Number(process.env.SIZE ?? 300);
const rows = JSON.parse("[" + Array.from({ length: size }, (_, i) => '{"price":' + i + ',"count":2}').join(",") + "]");
const said = [];
Object.defineProperty(rows[0], "price", { get() { said.push("price of 0"); return 1000; }, enumerable: true, configurable: true });
Object.defineProperty(rows[size - 1], "count", { get() { said.push("count of the last"); return 5; }, enumerable: true, configurable: true });
function total(rows) { let sum = 0; for (const row of rows) sum += row.price * row.count; return sum; }
console.log(total(rows), said.join(" | "));
