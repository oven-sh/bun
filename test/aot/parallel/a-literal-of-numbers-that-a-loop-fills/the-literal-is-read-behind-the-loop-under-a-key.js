// STATISTIC: LiteralsOfNumbersBornForWhatLoopStores >= 1
// Under: --aot-check=Validate: the storage that the literal is born with is what every access names
// Under: --aot-harden=proof-checks: what is remembered of the literal is asked of memory
'use strict';
function f(x, t, k) { const cur = [x * 0.5]; for (let j = 1; j < 20; j++) cur[j] = cur[j - 1] + j * 0.5; return cur[k & 1] + "|" + cur.length; }
const n = +process.argv[2] || 3; const keys = JSON.parse("[0, 1, 19, 25]"); let all = ""; for (let t = 0; t < n; t++) { all = ""; for (const k of keys) all += f(t + 1.5, t, k) + "/"; } console.log(all);
