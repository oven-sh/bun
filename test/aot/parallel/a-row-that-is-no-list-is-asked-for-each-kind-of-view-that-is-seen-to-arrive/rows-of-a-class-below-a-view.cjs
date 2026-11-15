"use strict";
// A class that extends Float32Array, one with a getter under an index above it.
function turn(rows, at, sine, cosine) { let held; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; rows[k][at + 1] = sine * rows[k][at] + cosine * held; rows[k][at] = cosine * rows[k][at] - sine * held; } }
const numbers = JSON.parse("[" + Array.from({ length: 6 }, (_, r) => "[" + Array.from({ length: 5 }, (_, c) => (r * 5 + c) % 7 + 0.25).join() + "]").join() + "]");
const said = [];
function show(rows) { said.push(rows.map(row => Array.from({ length: 6 }, (_, c) => String(row[c])).join(",")).join(";")); }
class Channel extends Float32Array { get gain() { return 2; } } const rows = numbers.map((r, i) => i & 1 ? Channel.from(r) : Float32Array.from(r)); for (let at = 0; at < 5; at++) { turn(rows, at, 0.6, 0.8); show(rows); } said.push(String(rows[1].gain), rows[1].constructor.name);
console.log(said.join("\n"));
