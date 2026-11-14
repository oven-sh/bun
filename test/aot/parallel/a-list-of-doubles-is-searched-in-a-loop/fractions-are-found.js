// STATISTIC: UnrolledLoopsForIndexingType >= 1
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every read
'use strict';
const n = +process.argv[2] || 3; const said = [];
function find(l, x) { for (let i = 0; i < l.length; i++) { if (l[i] === x) return i; } return -1; }
const row = (length, step) => JSON.parse("[" + Array.from({ length }, (_, i) => i * step + 0.5).join() + "]");
for (let t = 0; t < n; t++) { said.length = 0; const l = row(40, 1.5); said.push(find(l, 0.5), find(l, 30.5), find(l, 59), find(l, 7), find(l, "2"), find(l, undefined), find(l, null), find(l, l)); } console.log(said.join());
