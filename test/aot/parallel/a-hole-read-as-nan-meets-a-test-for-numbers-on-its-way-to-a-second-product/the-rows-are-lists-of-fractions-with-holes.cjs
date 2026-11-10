// Under: --aot-check=Validate: the program only reckons with `held`; the arms of its read meet in front of the second product, which tests for a number to choose its form: the check took that test for a user that tells NaN from undefined.
"use strict";
function turn(rows, at, sine, cosine) { let held; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; rows[k][at + 1] = sine * rows[k][at] + cosine * held; rows[k + 1][at] = cosine * rows[k][at] - sine * held; } }
const numbers = () => JSON.parse("[" + Array.from({ length: 6 }, (_, r) => "[" + Array.from({ length: 5 }, (_, c) => (r * 5 + c) % 7 + 0.25).join() + "]").join() + "]");
const said = [];
function show(rows) { said.push(rows.map(row => Array.from({ length: 6 }, (_, c) => (c in row ? "" : "hole:") + String(row[c])).join(",")).join(";")); }
function attempt(rows, at, sine, cosine) { try { turn(rows, at, sine, cosine); } catch (error) { said.push(String(error)); } show(rows); }
{ const rows = numbers(); delete rows[2][2]; delete rows[4][2]; attempt(rows, 1, 0.6, 0.8); }
{ const rows = numbers(); for (const row of rows) delete row[2]; attempt(rows, 1, 0.6, 0.8); attempt(rows, 1, 0.6, 0.8); }
console.log(said.join("\n"));
