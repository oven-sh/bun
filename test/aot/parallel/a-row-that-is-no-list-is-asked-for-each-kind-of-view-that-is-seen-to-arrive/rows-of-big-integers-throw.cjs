"use strict";
// A number stored into a view of big integers throws where it is written.
function turn(rows, at, sine, cosine) { let held; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; rows[k][at + 1] = sine * rows[k][at] + cosine * held; rows[k][at] = cosine * rows[k][at] - sine * held; } }
const numbers = JSON.parse("[" + Array.from({ length: 6 }, (_, r) => "[" + Array.from({ length: 5 }, (_, c) => (r * 5 + c) % 7 + 0.25).join() + "]").join() + "]");
const said = [];
function show(rows) { said.push(rows.map(row => Array.from({ length: 6 }, (_, c) => String(row[c])).join(",")).join(";")); }
const rows = [Float32Array.from(numbers[0]), BigInt64Array.from([1n, 2n, 3n]), Float32Array.from(numbers[1])]; try { turn(rows, 0, 0.6, 0.8); } catch (error) { said.push(error.name); } said.push(rows.map(row => Array.from(row, String).join()).join(";"));
console.log(said.join("\n"));
