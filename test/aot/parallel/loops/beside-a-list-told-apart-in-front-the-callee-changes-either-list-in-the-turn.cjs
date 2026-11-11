// STATISTIC: WalkLoopsVersioned >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
const from = JSON.parse('[1.5,2.5,3.5]'), list = JSON.parse('[' + Array.from({ length: 24 }, (_, i) => i + 0.5).join() + ']');
const odd = { at: -1, valueOf() { if (this.at === 0) list.length = 10; if (this.at === 1) from.length = 2; if (this.at === 2) list[20] = q; if (this.at === 3) from[2] = 100 + q; if (this.at === 4) Object.defineProperty(from, 0, { get() { return 1000 + q; }, configurable: true }); return 7; } };
function fresh() { list.length = 0; for (let i = 0; i < 24; i++) list.push(i + 0.5); from.length = 0; from.push(1.5, odd, 3.5); }
function worth(x) { return x === undefined ? -50 : +x; }
function pick(held, k) { return held[k]; }
function total(turn) { let sum = turn & 1; for (let i = 0; i < list.length; i++) sum = sum + list[i] + worth(pick(from, i % 3)); return sum; }
const said = []; for (let turn = 0; turn < 30; turn++) total(turn);
said.push(total(0));
for (let at = 0; at < 5; at++) { fresh(); odd.at = at; said.push(total(0)); odd.at = -1; said.push(total(1)); } console.log(said.join());
