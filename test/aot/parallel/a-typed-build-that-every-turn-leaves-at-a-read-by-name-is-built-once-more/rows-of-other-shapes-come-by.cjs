// The plain case: the method under a key out of data is copied in line; its reads ask their sites; some rows miss.
// STATISTIC: SiteCachedReadsBesideCalls >= 1
"use strict";
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
const k = JSON.parse('"go"');
function rowsOf(n, odd) { const rows = JSON.parse("[" + Array.from({ length: n }, (_, i) => '{"a":' + i + ',"b":' + (i * 7 % 11) + "}").join(",") + "]"); for (const [at, make] of odd) rows[at] = make(at); return rows; }
const otherShape = at => JSON.parse('{"late":1,"b":' + (at % 5) + ',"a":' + at + "}");
const without = at => JSON.parse('{"a":' + at + "}");
const T = { go(r) { return r.a * 2 + r.b; } };
const even = rowsOf(200, []), mixed = rowsOf(200, [[0, otherShape], [3, otherShape], [100, otherShape], [199, otherShape]]), lacking = rowsOf(200, [[50, without]]);
function f() { let c = 0; for (let i = 0; i < 200; i++) c += T[k](even[i]); return c; }
function g() { let c = 0; for (let i = 0; i < 200; i++) c += T[k](mixed[i]); return c; }
function h() { let c = 0; for (let i = 0; i < 200; i++) c += T[k](lacking[i]); return c; }
tell(f); tell(g); tell(h); tell(g);
console.log(said.join(" | "));
