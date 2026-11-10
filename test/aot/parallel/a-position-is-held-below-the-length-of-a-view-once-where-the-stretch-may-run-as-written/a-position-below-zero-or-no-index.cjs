"use strict";
// -1, a fraction, NaN, a text and 2 ** 32 stand as the position.
function turn(rows, at, sine, cosine) { let held; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; rows[k][at + 1] = sine * rows[k][at] + cosine * held; rows[k][at] = cosine * rows[k][at] - sine * held; } }
const numbers = JSON.parse("[" + Array.from({ length: 6 }, (_, r) => "[" + Array.from({ length: 5 }, (_, c) => (r * 5 + c) % 7 + 0.25).join() + "]").join() + "]");
const said = [];
function show(rows) { said.push(rows.map(row => Array.from({ length: 6 }, (_, c) => String(row[c])).join(",")).join(";")); }
for (const at of [-1, -2, 0.5, NaN, "1", 2 ** 32, 2 ** 53, -0]) { const rows = numbers.map(r => Float64Array.from(r)); turn(rows, at, 0.6, 0.8); show(rows); said.push(Object.keys(rows[0]).join()); }
console.log(said.join("\n"));
