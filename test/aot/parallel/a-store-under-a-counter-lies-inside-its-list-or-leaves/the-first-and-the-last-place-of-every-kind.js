// STATISTIC: RangeChecksRemoved >= 1
// Under: --aot-harden=proof-checks: the position of every store is held against the length of its list
'use strict';
const n = +process.argv[2] || 3; const said = [];
function turnRound(list) { const last = list.length - 1; for (let i = 0; i <= last; i++) { const was = list[i]; list[i] = list[last]; list[last] = was; } return last; }
function copy(from, into) { for (let i = 0; i < from.length; i++) into[i] = from[i]; return into.length; }
const show = l => Array.from(l, x => String(x)).join(" ") + "#" + l.length;
for (let t = 0; t < n; t++) { said.length = 0; for (const l of [[3, 1, 4, 0, 2], [0.5, 1.5, 2.5], ["a", "b", "c", "d"], [7], [], [1, 2.5, "x"], [1, , 3]]) { said.push(turnRound(l), show(l)); const into = [0, 0, 0]; said.push(copy(l, into), show(into)); } }
console.log(said.join("\n"));
