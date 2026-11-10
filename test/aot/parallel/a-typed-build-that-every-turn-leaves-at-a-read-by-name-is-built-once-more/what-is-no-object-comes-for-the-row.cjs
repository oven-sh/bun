// A number, a text, a Proxy, null.
// STATISTIC: ReadsThatAskTheirSitesInTurnsThatCall >= 1
"use strict";
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
const k = JSON.parse('"go"');
function rowsOf(n, odd) { const rows = JSON.parse("[" + Array.from({ length: n }, (_, i) => '{"a":' + i + ',"b":' + (i * 7 % 11) + "}").join(",") + "]"); for (const [at, make] of odd) rows[at] = make(at); return rows; }
const otherShape = at => JSON.parse('{"late":1,"b":' + (at % 5) + ',"a":' + at + "}");
const without = at => JSON.parse('{"a":' + at + "}");
let traps = 0; const proxied = at => new Proxy({ a: at, b: 4 }, { get(target, key) { traps++; return target[key]; } });
const T = { go(r) { const a = r.a; return (a === undefined ? 7 : a) * 2; } };
const even = rowsOf(200, []), mixed = rowsOf(200, [[3, () => 5], [4, () => "text"], [5, proxied], [6, () => true]]), none = rowsOf(200, [[90, () => null]]);
function f() { let c = 0; for (let i = 0; i < 200; i++) c += T[k](even[i]); return c; }
function g() { let c = 0; for (let i = 0; i < 200; i++) c += T[k](mixed[i]); return c; }
function h() { let c = 0; for (let i = 0; i < 200; i++) c += T[k](none[i]); return c; }
tell(f); tell(g); tell(() => traps); tell(h);
console.log(said.join(" | "));
