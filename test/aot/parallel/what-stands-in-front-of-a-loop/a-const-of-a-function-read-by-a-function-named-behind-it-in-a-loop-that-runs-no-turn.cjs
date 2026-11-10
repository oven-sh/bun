// What stands in front of a loop: a const of a function read by a function named behind it in a loop that runs no turn.
"use strict";
function go(turns, record) { let sum = 0; for (let turn = 0; turn < turns; turn++) { JSON.parse("1"); sum += record.read(turn); } return sum; }
function main() {
console.log("SAID const no-turn first " + go(Number("0"), null));
const held = { width: Number("5") };
const read = (turn) => held.width + turn;
console.log("SAID const no-turn second " + go(Number("3"), { read }));
}
main();
