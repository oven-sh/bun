// STATISTIC: LoopsLaidOutForOneKindOfStorage >= 1
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every read
'use strict';
const n = +process.argv[2] || 3; const said = [];
function find(l, x) { for (let i = 0; i < l.length; i++) { if (l[i] === x) return i; } return -1; }
const row = (length, step) => JSON.parse("[" + Array.from({ length }, (_, i) => i * step + 0.5).join() + "]");
class Row extends Array {} const written = () => [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5];
for (let t = 0; t < n; t++) { said.length = 0; const any = JSON.parse("[0]")[0] === 0 ? [row(12, 1), Object.freeze(row(12, 1)), Object.seal(row(12, 1)), written(), Row.from(row(12, 1)), Object.preventExtensions(row(12, 1))] : []; for (const l of any) said.push(find(l, 8.5), find(l, 99)); } console.log(said.join());
