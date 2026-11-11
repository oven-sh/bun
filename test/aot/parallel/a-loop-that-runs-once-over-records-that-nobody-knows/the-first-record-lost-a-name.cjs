"use strict";
// Records that hold many names and lose some keep their names in a table of their own, which changes in place: nothing about it may be filed for good.
const size = Number(process.env.SIZE ?? 200);
const rows = [];
for (let i = 0; i < size; i++) {
    const row = {};
    for (let k = 0; k < 80; k++) row["k" + k] = k;
    row.price = i; row.count = 2;
    for (let k = 0; k < 70; k++) delete row["k" + k];
    rows.push(row);
}
function total(rows) { let sum = 0; for (const row of rows) sum += row.price * row.count; return sum; }
const first = total(rows);
for (const row of rows) { delete row.price; row.late = 1; row.price = 3; }
console.log(first, total(rows));
