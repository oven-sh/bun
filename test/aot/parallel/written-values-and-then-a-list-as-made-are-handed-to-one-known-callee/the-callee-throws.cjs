'use strict';
// STATISTIC: SpreadCallsUnpackedToParameters >= 1
function inner(a, b, c) { if (c === 3) throw new RangeError("three " + a + b); return a + b + c; }
function outer(...rest) { return inner("w", ...rest); }
const byValue = JSON.parse("[0,1]").map(() => outer);
function run(turn) { try { return byValue[turn & 1](turn, turn % 4); } catch (error) { return error.message; } }
const turns = JSON.parse("7");
const out = [];
for (let turn = 0; turn < turns; turn++) out.push(run(turn));
console.log(out.join(" "));
