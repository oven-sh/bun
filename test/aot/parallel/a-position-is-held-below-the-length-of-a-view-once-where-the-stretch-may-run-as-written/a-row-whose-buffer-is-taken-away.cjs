"use strict";
// One row is detached between the calls; its reads give undefined and its stores do nothing.
function turn(rows, at, sine, cosine) { let held; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; rows[k][at + 1] = sine * rows[k][at] + cosine * held; rows[k][at] = cosine * rows[k][at] - sine * held; } }
const numbers = JSON.parse("[" + Array.from({ length: 6 }, (_, r) => "[" + Array.from({ length: 5 }, (_, c) => (r * 5 + c) % 7 + 0.25).join() + "]").join() + "]");
const said = [];
function show(rows) { said.push(rows.map(row => Array.from({ length: 6 }, (_, c) => String(row[c])).join(",")).join(";")); }
const rows = numbers.map(r => Float64Array.from(r)); turn(rows, 1, 0.6, 0.8); show(rows); structuredClone(rows[2].buffer, { transfer: [rows[2].buffer] }); turn(rows, 1, 0.6, 0.8); show(rows); said.push(String(rows[2].length));
console.log(said.join("\n"));
