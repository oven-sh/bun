// What stands in front of a loop: a reader named behind its variable reads through a method.
"use strict";
function go(turns, record) { let sum = 0; for (let turn = 0; turn < turns; turn++) { JSON.parse("1"); sum += record.read(turn); } return sum; }
try { console.log("SAID", go(Number("0"), null)); } catch (e) { console.log("SAID", e.name); }
class Held { constructor() { this.width = Number("5"); } size() { return this.width; } }
const held = new Held();
function read(turn) { return held.size() + turn; }
console.log("SAID", go(Number("3"), { read }));
