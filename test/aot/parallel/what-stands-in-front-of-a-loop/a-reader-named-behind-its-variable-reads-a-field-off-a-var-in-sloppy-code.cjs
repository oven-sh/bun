// What stands in front of a loop: a reader named behind its variable reads a field off a var in sloppy code.
function go(turns, record) { let sum = 0; for (let turn = 0; turn < turns; turn++) { JSON.parse("1"); sum += record.read(turn); } return sum; }
try { console.log("SAID", go(Number("0"), null)); } catch (e) { console.log("SAID", e.name); }
var held = { width: Number("5") };
function read(turn) { return held.width + turn; }
console.log("SAID", go(Number("3"), { read }));
