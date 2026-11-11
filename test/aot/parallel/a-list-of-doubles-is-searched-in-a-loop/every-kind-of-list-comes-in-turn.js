// STATISTIC: UnrolledLoopsForIndexingType >= 1
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every read
'use strict';
const n = +process.argv[2] || 3; const said = [];
function find(l, x) { for (let i = 0; i < l.length; i++) { if (l[i] === x) return i; } return -1; }
const row = (length, step) => JSON.parse("[" + Array.from({ length }, (_, i) => i * step + 0.5).join() + "]");
for (let t = 0; t < n; t++) { said.length = 0; const lists = [row(20, 1), JSON.parse("[1,2,3,4,5,6,7,8,9,10,11,12]"), JSON.parse("[\"a\",\"b\",3.5,\"d\",5,6,7,8,9,10,11,12]"), [], row(20, 1), JSON.parse("[{},[],null,true,3.5,6,7,8,9,10,11,12]")]; for (const l of lists) said.push(find(l, 3.5), find(l, 5), find(l, "d"), find(l, null)); } console.log(said.join());
