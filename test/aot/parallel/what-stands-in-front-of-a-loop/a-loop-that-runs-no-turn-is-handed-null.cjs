// What stands in front of a loop: a loop that runs no turn is handed null.
"use strict";
const said = [];
function attempt(f) { try { return f(); } catch (e) { return e.constructor.name; } }
function go(turns, record) { let sum = 0; for (let turn = 0; turn < turns; turn++) { sum += record.read(turn); } return sum; }
const held = { width: Number("5") };
function read(turn) { return held.width + turn; }
function away(turn) { return -turn; }
function wrap() { return { read }; }
function odd(read) { return { read }; }
function other() { return { width: 1 }; }
said.push(go(Number("0"), null));
said.push(go(Number("3"), wrap()));
console.log("SAID", JSON.stringify(said));
