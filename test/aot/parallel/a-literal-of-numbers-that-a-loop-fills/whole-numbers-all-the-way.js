// STATISTIC: ArrayLiteralsAllocatedForLoops >= 1
// Under: --aot-check=Validate: the storage that the literal is born with is what every access names
// Under: --aot-harden=proof-checks: what is remembered of the literal is asked of memory
'use strict';
function f(x, t) { const cur = [x | 0]; for (let j = 1; j < 20; j++) cur[j] = (cur[j - 1] + j) | 0; return cur.length + "|" + cur[0] + "|" + cur[19] + "|" + cur.join(); }
const n = +process.argv[2] || 3; const given = JSON.parse("[2147483647, -5, 0]"); let all = ""; for (let t = 0; t < n; t++) { all = ""; for (const g of given) all += f(g + t, t) + "/"; } console.log(all);
