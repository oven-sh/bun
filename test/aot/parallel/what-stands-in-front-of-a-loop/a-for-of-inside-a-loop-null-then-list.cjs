// What stands in front of a loop: a for of inside a loop null then list.
"use strict";
const said = [];
function attempt(f) { try { return f(); } catch (e) { return e.constructor.name; } }
function go(turns, list) { let sum = 0; for (let turn = 0; turn < turns; turn++) { for (const each of list) sum += each; } return sum; }
function other() { return { width: 1 }; }
said.push(go(Number("0"), null));
said.push(go(Number("2"), [1, 2, Number("3")]));
console.log("SAID", JSON.stringify(said));
