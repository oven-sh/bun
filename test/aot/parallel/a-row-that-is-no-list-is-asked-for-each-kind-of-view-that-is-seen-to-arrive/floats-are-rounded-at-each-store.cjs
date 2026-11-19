"use strict";
// What is read back is the rounded float, not the double that was stored.
function turn(rows, at, sine, cosine) { let held; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; rows[k][at + 1] = sine * rows[k][at] + cosine * held; rows[k][at] = cosine * rows[k][at] - sine * held; } }
const numbers = JSON.parse("[" + Array.from({ length: 6 }, (_, r) => "[" + Array.from({ length: 5 }, (_, c) => (r * 5 + c) % 7 + 0.25).join() + "]").join() + "]");
const said = [];
function show(rows) { said.push(rows.map(row => Array.from({ length: 6 }, (_, c) => String(row[c])).join(",")).join(";")); }
const rows = [Float32Array.from([0.1, 0.2, 0.3, 16777217, 1e-46]), Float32Array.from([1 / 3, 2 / 3, 1e39, -1e39, 0.7])]; for (let at = 0; at < 4; at++) { turn(rows, at, 1 / 3, 2 / 3); show(rows); }
console.log(said.join("\n"));
