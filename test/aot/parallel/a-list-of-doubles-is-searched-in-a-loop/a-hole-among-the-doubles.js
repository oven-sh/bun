// STATISTIC: LoopsLaidOutForOneKindOfStorage >= 1
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every read
'use strict';
const n = +process.argv[2] || 3; const said = [];
function find(l, x) { for (let i = 0; i < l.length; i++) { if (l[i] === x) return i; } return -1; }
const row = (length, step) => JSON.parse("[" + Array.from({ length }, (_, i) => i * step + 0.5).join() + "]");
for (let t = 0; t < n; t++) { said.length = 0; const l = row(20, 1); delete l[11]; said.push(find(l, undefined), find(l, 11.5), find(l, 12.5), 11 in l); const above = Object.create(Array.prototype); above[11] = "above"; Object.setPrototypeOf(l, above); said.push(find(l, "above"), find(l, undefined), find(l, 12.5)); } console.log(said.join());
