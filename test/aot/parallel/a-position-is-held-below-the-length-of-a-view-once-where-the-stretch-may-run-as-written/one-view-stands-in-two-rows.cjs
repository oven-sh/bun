"use strict";
// The same view twice, and two views over one buffer, one element apart.
function turn(rows, at, sine, cosine) { let held; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; rows[k][at + 1] = sine * rows[k][at] + cosine * held; rows[k][at] = cosine * rows[k][at] - sine * held; } }
const numbers = JSON.parse("[" + Array.from({ length: 6 }, (_, r) => "[" + Array.from({ length: 5 }, (_, c) => (r * 5 + c) % 7 + 0.25).join() + "]").join() + "]");
const said = [];
function show(rows) { said.push(rows.map(row => Array.from({ length: 6 }, (_, c) => String(row[c])).join(",")).join(";")); }
const shared = new Float64Array(8).map((_, i) => i + 0.5); const rows = [shared, shared, shared.subarray(1), shared.subarray(2, 5)]; for (let at = 0; at < 4; at++) { turn(rows, at, 0.6, 0.8); show(rows); }
console.log(said.join("\n"));
