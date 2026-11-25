// What stands in front of a loop: a lookup in a loop no turn null.
"use strict";
const said = [];
function attempt(f) { try { return f(); } catch (e) { return e.constructor.name; } }
function go(turns, table, key, stop) { let sum = 0; for (let turn = 0; turn < turns; turn++) { if (stop) break; sum += table.get(key); } return sum; }
function fill() { return new Map([["k", Number("5")]]); }
said.push(go(Number("0"), null, "k", JSON.parse("false")));
said.push(go(Number("3"), fill(), "k", JSON.parse("false")));
console.log("SAID", JSON.stringify(said));
