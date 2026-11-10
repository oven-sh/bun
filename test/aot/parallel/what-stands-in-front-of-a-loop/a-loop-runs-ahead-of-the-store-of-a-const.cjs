// What stands in front of a loop: a loop runs ahead of the store of a const.
"use strict";
const said = [];
function attempt(f) { try { return f(); } catch (e) { return e.constructor.name; } }
function go(turns, record) { let sum = 0; for (let turn = 0; turn < turns; turn++) { sum += record.read(turn); } return sum; }
function read(turn) { return held.width + turn; }
function wrap() { return { read }; }
said.push(go(Number("0"), wrap()));
const held = { width: Number("5") };
said.push(go(Number("3"), wrap()));
console.log("SAID", JSON.stringify(said));
