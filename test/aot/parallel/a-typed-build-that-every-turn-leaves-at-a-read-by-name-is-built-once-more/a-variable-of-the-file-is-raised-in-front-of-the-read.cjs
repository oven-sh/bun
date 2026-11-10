// An effect stands in front of the read in the same turn: the read may not begin the turn again: the count is exact.
// STATISTIC: SiteCachedReadsBesideCalls = 0
"use strict";
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
const k = JSON.parse('"go"');
function rowsOf(n, odd) { const rows = JSON.parse("[" + Array.from({ length: n }, (_, i) => '{"a":' + i + ',"b":' + (i * 7 % 11) + "}").join(",") + "]"); for (const [at, make] of odd) rows[at] = make(at); return rows; }
const otherShape = at => JSON.parse('{"late":1,"b":' + (at % 5) + ',"a":' + at + "}");
const without = at => JSON.parse('{"a":' + at + "}");
let count = 0;
const T = { go(r) { count += 1; return r.a * 2 + r.b; } };
const even = rowsOf(200, []), mixed = rowsOf(200, [[0, otherShape], [3, otherShape], [100, otherShape], [101, without], [199, otherShape]]);
function f() { let c = 0; for (let i = 0; i < 200; i++) c += T[k](even[i]); return c; }
function g() { let c = 0; for (let i = 0; i < 200; i++) c += T[k](mixed[i]); return c; }
tell(f); tell(() => count); tell(g); tell(() => count);
console.log(said.join(" | "));
