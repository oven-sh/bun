// STATISTIC: ArrayLiteralsAllocatedForLoops >= 1
// Under: --aot-check=Validate: the storage that the literal is born with is what every access names
// Under: --aot-harden=proof-checks: what is remembered of the literal is asked of memory
'use strict';
function f(x, t) { const cur = [x * 0.5]; for (let j = 1; j < 20; j++) cur[j] = cur[j - 1] + j * 0.5 + t; return Object.is(cur[0], -0) + "|" + 1 / cur[0] + "|" + cur.length + "|" + cur[19]; }
const n = +process.argv[2] || 3; const given = JSON.parse("[-0, 0, 2.5]"); let all = ""; for (let t = 0; t < n; t++) { all = ""; for (const g of given) all += f(g, t) + "/"; } console.log(all);
