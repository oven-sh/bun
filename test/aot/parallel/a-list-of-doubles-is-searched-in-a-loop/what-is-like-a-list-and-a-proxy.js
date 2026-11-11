// STATISTIC: UnrolledLoopsForIndexingType >= 1
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every read
'use strict';
const n = +process.argv[2] || 3; const said = [];
function find(l, x) { for (let i = 0; i < l.length; i++) { if (l[i] === x) return i; } return -1; }
const row = (length, step) => JSON.parse("[" + Array.from({ length }, (_, i) => i * step + 0.5).join() + "]");
for (let t = 0; t < n; t++) { said.length = 0; const like = { length: 10 }; for (let i = 0; i < 10; i++) like[i] = i + 0.5; let asked = 0; const lists = [row(12, 1), like, new Float64Array(row(12, 1)), "0123456789", new Proxy(row(12, 1), { get(o, k, r) { asked++; return Reflect.get(o, k, r); } }), row(12, 1)]; for (const l of lists) said.push(find(l, 8.5), find(l, "8")); said.push(asked); } console.log(said.join());
