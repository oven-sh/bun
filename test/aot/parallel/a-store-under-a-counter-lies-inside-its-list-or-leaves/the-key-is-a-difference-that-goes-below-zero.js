// STATISTIC: RangeChecksRemoved >= 1
// Under: --aot-harden=proof-checks: the position of every store is held against the length of its list
'use strict';
const n = +process.argv[2] || 3; const said = [];
function mirror(list, k, turns) { for (let i = 0; i < turns; i++) { const temp = list[i]; list[i] = list[k - i]; list[k - i] = temp; } return list.length; }
const show = l => Array.from(l, x => String(x)).join(" ") + "#" + l.length + "#" + Object.keys(l).join();
for (let t = 0; t < n; t++) { said.length = 0; { const l = [3, 1, 4, 0, 2, 6, 5]; said.push(mirror(l, 6, 3), show(l)); } { const l = [3, 1, 4, 0, 2]; said.push(mirror(l, 1, 4), show(l), l[-1], l[-2]); } { const l = [5, 6, 7, 8]; said.push(mirror(l, 0, 3), show(l), l[-1], l[-2]); } { const l = [9, 8, 7]; said.push(mirror(l, -1, 2), show(l)); } }
console.log(said.join("\n"));
