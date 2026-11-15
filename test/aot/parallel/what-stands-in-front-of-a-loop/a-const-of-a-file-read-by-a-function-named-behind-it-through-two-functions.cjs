// What stands in front of a loop: a const of a file read by a function named behind it through two functions.
"use strict";
function inner(record, turn) { return record.read(turn); }
function go(turns, record) { let sum = 0; for (let turn = 0; turn < turns; turn++) { JSON.parse("1"); sum += inner(record, turn); } return sum; }
console.log("SAID const two-copies-deep first " + go(Number("0"), null));
const held = { width: Number("5") };
function read(turn) { return held.width + turn; }
console.log("SAID const two-copies-deep second " + go(Number("3"), { read }));
