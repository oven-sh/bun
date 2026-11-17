// STATISTIC: FlowAppendedFields >= 2
"use strict";
function add(a, b) { return (a + b) | 0; }
function mul(a, b) { return (a * b) % 1009; }
function low(a) { return a & 15; }
function attempt(run) { try { return String(run()); } catch (error) { return error instanceof TypeError ? "TypeError" : "another"; } }
function call(which) { try { return which === 0 ? N.add(2, 3) : which === 1 ? N.mul(4, 5) : N.low(19); } catch (error) { return error instanceof TypeError ? "TypeError" : "another"; } }
function tell() { return call(0) + " " + call(1) + " " + call(2) + " " + typeof N.add + " " + typeof N.mul + " " + typeof N.low + " " + (N.add === add) + " " + (N.mul === mul) + " " + (N.low === low) + " " + (N.mul === low) + " " + (N.mul === add); }
const out = [];
const seen = [];
const N = {}, impl = { add: add, ["__proto__"]: { set low(value) { seen.push(value(21), typeof value); } }, low: low };
for (var k in impl) N[k] = impl[k];
for (let round = 0; round < 12; round++) out.push(tell());
console.log([...new Set(out.map(String))].join("\n"));
