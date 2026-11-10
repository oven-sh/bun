'use strict';
// STATISTIC: CallsWhoseParametersAreReadOutOfList >= 1
function inner(who, count, first, second) { return [typeof who, count, first === undefined ? "none" : first, second === undefined ? "none" : second].join(":"); }

function outer(...rest) { return inner(outer, rest.length, ...rest); }
const long = Array.from({ length: 70000 }, (_, i) => i);
const byValue = JSON.parse("[0,1]").map(() => outer);
function run(turn) { try { return byValue[turn & 1].apply(null, turn === 3 ? long : [turn]); } catch (error) { return error.constructor.name; } }
const turns = JSON.parse("7");
const out = [];
for (let turn = 0; turn < turns; turn++) out.push(run(turn));
console.log(out.join(" "));
