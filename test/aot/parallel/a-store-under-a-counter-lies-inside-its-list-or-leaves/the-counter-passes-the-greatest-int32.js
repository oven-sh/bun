// STATISTIC: RangeChecksRemoved >= 1
// Under: --aot-harden=proof-checks: the position of every store is held against the length of its list
'use strict';
const n = +process.argv[2] || 3; const said = [];
function fill(list, from, turns) { let i = from | 0; for (let t = 0; t < turns; t++) { const was = list[i]; list[i] = was === undefined ? t : was + t; i = (i + 1) | 0; } return i; }
const show = l => Object.keys(l).join() + "#" + l.length;
for (let t = 0; t < n; t++) { said.length = 0; { const l = [3, 1, 4, 0, 2, 6, 5]; said.push(fill(l, 0, 7), show(l), l.join()); } { const l = [3, 1, 4]; said.push(fill(l, 2147483646, 4), show(l), l[2147483647], l[-2147483648], l[-2147483647]); } { const l = [3, 1, 4]; said.push(fill(l, -1, 3), show(l), l.join(), l[-1]); } }
console.log(said.join("\n"));
