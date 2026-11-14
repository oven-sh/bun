'use strict';
// STATISTIC: SpreadCallsUnpackedToParameters = 0
function inner(who, count, first, second) { return [typeof who, count, first === undefined ? "none" : first, second === undefined ? "none" : second].join(":"); }

const others = [new Set([1, 2]), "ab", new Map([[1, 2]]).keys(), (function* () { yield "g1"; yield "g2"; })(), new Uint8Array([7, 8])];
function outer(iterable) { return inner(outer, 0, ...iterable); }
const byValue = JSON.parse("[0,1]").map(() => outer);
function run(turn) { return turn < others.length ? byValue[turn & 1](others[turn]) : "-"; }
const turns = JSON.parse("7");
const out = [];
for (let turn = 0; turn < turns; turn++) out.push(run(turn));
console.log(out.join(" "));
