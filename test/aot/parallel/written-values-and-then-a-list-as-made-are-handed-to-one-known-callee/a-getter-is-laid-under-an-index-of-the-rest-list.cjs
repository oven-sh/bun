'use strict';
// STATISTIC: CallsWhoseParametersAreReadOutOfList = 0
function inner(who, count, first, second) { return [typeof who, count, first === undefined ? "none" : first, second === undefined ? "none" : second].join(":"); }

let asked = 0;
function outer(...rest) { Object.defineProperty(rest, 0, { get() { asked++; return "got" + asked; }, configurable: true }); return inner(outer, rest.length, ...rest); }
const byValue = JSON.parse("[0,1]").map(() => outer);
function run(turn) { return byValue[turn & 1](turn, "b") + asked; }
const turns = JSON.parse("7");
const out = [];
for (let turn = 0; turn < turns; turn++) out.push(run(turn));
console.log(out.join(" "));
