// STATISTIC: LoopsLaidOutForOneKindOfStorage >= 1
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every read
'use strict';
const n = +process.argv[2] || 3; const said = [];
function find(l, x) { for (let i = 0; i < l.length; i++) { if (l[i] === x) return i; } return -1; }
const row = (length, step) => JSON.parse("[" + Array.from({ length }, (_, i) => i * step + 0.5).join() + "]");
for (let t = 0; t < n; t++) { said.length = 0; const odd = JSON.parse("[0.5,2,-0,3,1e21,-7,2147483648,4.25,9,10,11,12,13,14,15,16,17,18,19,20]"); odd[8] = 0 / (t - t); const lists = [row(20, 1), odd]; for (const l of lists) said.push(find(l, 2), find(l, 0), find(l, -0), find(l, 3), find(l, 2147483648), find(l, -7), find(l, 0 / (t - t)), find(l, 20), find(l, 1e21)); } console.log(said.join());
