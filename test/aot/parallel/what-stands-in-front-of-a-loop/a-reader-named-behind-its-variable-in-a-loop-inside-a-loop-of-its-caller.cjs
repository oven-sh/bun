// What stands in front of a loop: a reader named behind its variable in a loop inside a loop of its caller.
"use strict";
function go(turns, record) { let sum = 0; for (let turn = 0; turn < turns; turn++) { JSON.parse("1"); sum += record.read(turn); } return sum; }
function all(rounds, turns, record) { let total = 0; for (let round = 0; round < rounds; round++) total += go(turns, record); return total; }
console.log("SAID", all(Number("0"), Number("3"), null), all(Number("2"), Number("0"), null));
const held = { width: Number("5") };
function read(turn) { return held.width + turn; }
console.log("SAID", all(Number("2"), Number("3"), { read }));
