// What stands in front of a loop: a reader named behind its variable in a loop left by a break ahead of the call.
"use strict";
function go(turns, record) { let sum = 0; for (let turn = 0; turn < turns; turn++) { JSON.parse("1"); if (record === null) break; sum += record.read(turn); } return sum; }
try { console.log("SAID", go(Number("2"), null)); } catch (e) { console.log("SAID", e.name); }
const held = { width: Number("5") };
function read(turn) { return held.width + turn; }
console.log("SAID", go(Number("3"), { read }));
