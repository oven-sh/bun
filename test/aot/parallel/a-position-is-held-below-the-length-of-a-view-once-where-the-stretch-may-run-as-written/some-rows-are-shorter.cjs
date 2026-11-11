"use strict";
// Rows of five, three, one and no elements stand in one list.
function turn(rows, at, sine, cosine) { let held; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; rows[k][at + 1] = sine * rows[k][at] + cosine * held; rows[k][at] = cosine * rows[k][at] - sine * held; } }
const numbers = JSON.parse("[" + Array.from({ length: 6 }, (_, r) => "[" + Array.from({ length: 5 }, (_, c) => (r * 5 + c) % 7 + 0.25).join() + "]").join() + "]");
const said = [];
function show(rows) { said.push(rows.map(row => Array.from({ length: 6 }, (_, c) => String(row[c])).join(",")).join(";")); }
const rows = numbers.map((r, i) => Float64Array.from(r.slice(0, [5, 3, 1, 0, 5, 2][i]))); for (let at = 0; at < 5; at++) { turn(rows, at, 0.6, 0.8); show(rows); }
console.log(said.join("\n"));
