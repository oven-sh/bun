"use strict";
// The sites are full when code runs at last: what it does to the records behind it and to the list is seen.
const size = Number(process.env.SIZE ?? 300);
const rows = JSON.parse("[" + Array.from({ length: size }, (_, i) => '{"price":' + i + ',"count":2}').join(",") + "]");
const middle = size >> 1;
Object.defineProperty(rows[middle], "count", { get() {
    delete rows[middle + 1].price; rows[middle + 1].price = 1000;
    Object.defineProperty(rows[middle + 2], "price", { value: 2000 });
    rows[middle + 3] = { count: 1, price: 3000 };
    rows.push({ price: 4000, count: 1 });
    return 1;
}, configurable: true });
function total(rows) { let sum = 0; for (const row of rows) sum += row.price * row.count; return sum; }
console.log(total(rows), rows.length);
