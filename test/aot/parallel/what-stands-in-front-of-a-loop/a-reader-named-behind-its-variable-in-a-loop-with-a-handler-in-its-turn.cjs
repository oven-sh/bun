// What stands in front of a loop: a reader named behind its variable in a loop with a handler in its turn.
"use strict";
function go(turns, record) { let sum = 0; for (let turn = 0; turn < turns; turn++) { try { JSON.parse("1"); sum += record.read(turn); } catch (e) { sum = -1; } } return sum; }
try { console.log("SAID", go(Number("0"), null)); } catch (e) { console.log("SAID", e.name); }
const held = { width: Number("5") };
function read(turn) { return held.width + turn; }
console.log("SAID", go(Number("3"), { read }));
