// STATISTIC: RangeChecksRemoved >= 1
// Under: --aot-harden=proof-checks: the position of every store is held against the length of its list
'use strict';
const n = +process.argv[2] || 3; const said = [];
function raise(list, from, to) { let sum = 0; for (let i = from; i < to; i++) { const was = list[i]; list[i] = was === undefined ? 7 : was + 1; sum += list[i]; } return sum; }
const show = l => Array.from(l, x => String(x)).join(" ") + "#" + l.length + "#" + Object.keys(l).join();
for (let t = 0; t < n; t++) { said.length = 0; { const l = [3, 1, 4, 0, 2, 6, 5]; said.push(raise(l, 0, 7), show(l)); } { const l = [3, 1, 4, 0]; said.push(raise(l, -2, 4), show(l), l[-1], l[-2]); } { const l = [1.5, 2.5, 3.5]; said.push(raise(l, -1, 3), show(l), l[-1]); } { const l = [3, 1]; said.push(raise(l, -2147483648, -2147483646), show(l)); } }
console.log(said.join("\n"));
