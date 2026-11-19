// What stands in front of a loop: a reader named behind its variable reads a byte of a view.
"use strict";
function go(turns, record) { let sum = 0; for (let turn = 0; turn < turns; turn++) { JSON.parse("1"); sum += record.read(turn); } return sum; }
try { console.log("SAID", go(Number("0"), null)); } catch (e) { console.log("SAID", e.name); }
const held = new Uint8Array([Number("5"), 6, 7]);
function read(turn) { return held[turn]; }
console.log("SAID", go(Number("3"), { read }));
