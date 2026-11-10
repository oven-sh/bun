// Under: --aot-check=Validate: `held | 0` behind the two products: what passes the test for an int32 is handed on as it is, and the check followed it back to the read that takes NaN for a hole: but no hole passes that test.
"use strict";
const told = [];
function turn(rows, at, sine, cosine) { let held; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; rows[k][at + 1] = sine * rows[k][at] + cosine * held; rows[k + 1][at] = cosine * rows[k][at] - sine * held; told.push(held | 0); } }
const numbers = () => JSON.parse("[" + Array.from({ length: 6 }, (_, r) => "[" + Array.from({ length: 5 }, (_, c) => (r * 5 + c) % 7 + 0.25).join() + "]").join() + "]");
const said = [];
function show(rows) { said.push(rows.map(row => Array.from({ length: 6 }, (_, c) => (c in row ? "" : "hole:") + String(row[c])).join(",")).join(";")); }
function attempt(rows, at, sine, cosine) { try { turn(rows, at, sine, cosine); } catch (error) { said.push(String(error)); } show(rows); }
{ const rows = numbers(); delete rows[2][2]; delete rows[4][2]; attempt(rows, 1, 0.6, 0.8); }
{ const rows = numbers(); for (const row of rows) delete row[2]; attempt(rows, 1, 0.6, 0.8); attempt(rows, 1, 0.6, 0.8); }
{ const rows = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, , 12]].map(row => row.map(n => n)); attempt(rows, 1, 2, 3); }
console.log(said.join("\n"));
console.log(told.join());
