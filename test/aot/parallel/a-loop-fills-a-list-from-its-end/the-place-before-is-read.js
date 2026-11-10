// STATISTIC: StoresThatLengthenTheirListInEveryTurn >= 1
// STATISTIC: LiteralsOfNumbersBornForWhatLoopStores >= 1
// Under: --aot-harden=proof-checks: the raise asks at the run what the walk has shown: the position is the length and lies below the room
'use strict';
function f(t) { const cur = [t + 0.5]; for (let j = 1; j < 50; j++) cur[j] = cur[j - 1] + j * 0.5; return cur.length + "|" + cur[49] + "|" + cur.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
