// STATISTIC: BasesInFrontOfTypedCopiesAskedForLists <= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
const parts = JSON.parse('[[1.5,2.5,3.5],{"0":1.5,"1":' + q + '},"ab"]'), list = JSON.parse('[' + Array.from({ length: 40 }, (_, i) => i + 0.5).join() + ']');
function pick(take, held, k) { if (!take) return 0; return held[k]; }
function total(from, last, turn) { let sum = turn & 1; for (let i = 0; i < list.length; i++) sum = sum + list[i] + pick(i === last, from, i & 1); return sum; }
const said = []; for (const from of parts) { let s = 0; for (let turn = 0; turn < 20; turn++) s = total(from, -1, turn); said.push(s, total(from, 39, 0)); } console.log(said.join());
