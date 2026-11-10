// STATISTIC: InvariantBasesGuardedAsArrays >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
const parts = JSON.parse('[[1.5,2.5,' + q + '],{"0":1.5,"1":2.5},"ab"]'), list = JSON.parse('[' + Array.from({ length: 40 }, (_, i) => i + 0.5).join() + ']');
const from = parts[0];
function pick(held, k) { return held[k]; }
function total(turn) { let sum = turn & 1; for (let i = 0; i < list.length; i++) sum = sum + list[i] + pick(from, i % 3); return sum; }
let all = 0; for (let turn = 0; turn < 40; turn++) all += total(turn); console.log(all);
