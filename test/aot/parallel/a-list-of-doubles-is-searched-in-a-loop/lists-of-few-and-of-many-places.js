// STATISTIC: LoopsLaidOutForOneKindOfStorage >= 1
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every read
'use strict';
const n = +process.argv[2] || 3; const said = [];
function find(l, x) { for (let i = 0; i < l.length; i++) { if (l[i] === x) return i; } return -1; }
const row = (length, step) => JSON.parse("[" + Array.from({ length }, (_, i) => i * step + 0.5).join() + "]");
for (let t = 0; t < n; t++) { said.length = 0; const lists = [row(0, 1), row(1, 1), row(2, 1), row(7, 1), row(8, 1), row(9, 1), row(15, 1), row(16, 1), row(17, 1), row(63, 1), row(64, 1), row(65, 1), row(200, 1)]; for (const l of lists) { const sought = JSON.parse("[" + (l.length - 0.5) + "," + (l.length + 0.5) + ",0.5]"); said.push(find(l, sought[0]), find(l, sought[1]), find(l, sought[2])); } } console.log(said.join());
