"use strict";
// A view that follows the length of a resizable buffer.
function turn(rows, at, sine, cosine) { let held; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; rows[k][at + 1] = sine * rows[k][at] + cosine * held; rows[k][at] = cosine * rows[k][at] - sine * held; } }
const numbers = JSON.parse("[" + Array.from({ length: 6 }, (_, r) => "[" + Array.from({ length: 5 }, (_, c) => (r * 5 + c) % 7 + 0.25).join() + "]").join() + "]");
const said = [];
function show(rows) { said.push(rows.map(row => Array.from({ length: 6 }, (_, c) => String(row[c])).join(",")).join(";")); }
const buffer = new ArrayBuffer(40, { maxByteLength: 80 }); const rows = numbers.map(r => Float64Array.from(r)); rows[3] = new Float64Array(buffer); rows[3].set(numbers[3]); for (const bytes of [40, 16, 8, 0, 80, 24]) { buffer.resize(bytes); turn(rows, 1, 0.6, 0.8); show(rows); }
console.log(said.join("\n"));
