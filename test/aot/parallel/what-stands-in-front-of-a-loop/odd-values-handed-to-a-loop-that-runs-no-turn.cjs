// What stands in front of a loop: odd values handed to a loop that runs no turn.
"use strict";
function sum(turns, box) { let s = 0; for (let turn = 0; turn < turns; turn++) { s = (s + box.width) | 0; } return s; }
for (const odd of [null, undefined, 7, 1.5, "text", true, 5n, Symbol.iterator]) console.log("SAID", sum(Number("0"), odd));
console.log("SAID", sum(Number("3"), { width: Number("5") }));
