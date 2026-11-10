"use strict";
// NaN, the infinities and -0 go through the rows.
function turn(rows, at, sine, cosine) { let held; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; rows[k][at + 1] = sine * rows[k][at] + cosine * held; rows[k][at] = cosine * rows[k][at] - sine * held; } }
const numbers = JSON.parse("[" + Array.from({ length: 6 }, (_, r) => "[" + Array.from({ length: 5 }, (_, c) => (r * 5 + c) % 7 + 0.25).join() + "]").join() + "]");
const said = [];
function show(rows) { said.push(rows.map(row => Array.from({ length: 6 }, (_, c) => String(row[c])).join(",")).join(";")); }
for (const [sine, cosine] of [[NaN, 1], [Infinity, 0], [-0, -0], [1e308, 1e308], [5e-324, 5e-324]]) { const rows = numbers.map(r => Float64Array.from(r)); turn(rows, 1, sine, cosine); show(rows); }
console.log(said.join("\n"));
