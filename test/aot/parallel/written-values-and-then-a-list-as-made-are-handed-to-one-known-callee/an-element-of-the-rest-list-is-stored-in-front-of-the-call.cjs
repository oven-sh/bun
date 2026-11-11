'use strict';
// STATISTIC: SpreadCallsUnpackedToParameters = 0
function inner(who, count, first, second) { return [typeof who, count, first === undefined ? "none" : first, second === undefined ? "none" : second].join(":"); }

function outer(...rest) { rest[0] = "stored"; return inner(outer, rest.length, ...rest); }
const byValue = JSON.parse("[0,1]").map(() => outer);
function run(turn) { return byValue[turn & 1](turn, "b") + byValue[turn & 1](); }
const turns = JSON.parse("7");
const out = [];
for (let turn = 0; turn < turns; turn++) out.push(run(turn));
console.log(out.join(" "));
