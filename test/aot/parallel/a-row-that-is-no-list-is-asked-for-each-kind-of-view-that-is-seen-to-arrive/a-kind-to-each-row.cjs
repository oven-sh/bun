"use strict";
// Each row is of another kind; lists and an object stand among them.
function turn(rows, at, sine, cosine) { let held; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; rows[k][at + 1] = sine * rows[k][at] + cosine * held; rows[k][at] = cosine * rows[k][at] - sine * held; } }
const numbers = JSON.parse("[" + Array.from({ length: 6 }, (_, r) => "[" + Array.from({ length: 5 }, (_, c) => (r * 5 + c) % 7 + 0.25).join() + "]").join() + "]");
const said = [];
function show(rows) { said.push(rows.map(row => Array.from({ length: 6 }, (_, c) => String(row[c])).join(",")).join(";")); }
const makers = [r => Float32Array.from(r), r => Int32Array.from(r), r => r.slice(), r => Uint8ClampedArray.from(r), r => Object.assign({}, r), r => Float64Array.from(r)]; const rows = numbers.map((r, i) => makers[i](r.map(v => v * 37))); for (let at = 0; at < 6; at++) { turn(rows, at, 0.6, -0.8); show(rows); }
console.log(said.join("\n"));
