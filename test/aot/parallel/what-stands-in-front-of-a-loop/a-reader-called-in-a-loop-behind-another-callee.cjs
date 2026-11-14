// What stands in front of a loop: a reader called in a loop behind another callee.
"use strict";
function go(turns, record) { let sum = 0; for (let turn = 0; turn < turns; turn++) { JSON.parse("1"); sum += record.read(turn); } return sum; }
function early(turn) { return turn; }
console.log("SAID first " + (go(Number("2"), { read: early })));
const held = { width: Number("5") };
function read(turn) { return held.width + turn; }
console.log("SAID second " + (go(Number("3"), { read })));
