// What stands in front of a loop: a const of a file read by a function named behind it behind a condition in the turn.
"use strict";
function go(turns, record) { let sum = 0; for (let turn = 0; turn < turns; turn++) { JSON.parse("1"); if (record !== null) sum += record.read(turn); } return sum; }
console.log("SAID const behind-a-condition first " + go(Number("3"), null));
const held = { width: Number("5") };
function read(turn) { return held.width + turn; }
console.log("SAID const behind-a-condition second " + go(Number("3"), { read }));
