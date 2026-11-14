// STATISTIC: ArrayLiteralsAllocatedForLoops >= 1
// Under: --aot-check=Validate: the storage that the literal is born with is what every access names
// Under: --aot-harden=proof-checks: what is remembered of the literal is asked of memory
'use strict';
function f(x, y, t) { const cur = [x * 0.5, y * 0.5]; for (let j = 2; j < 20; j++) cur[j] = (cur[j - 1] === cur[j - 1] ? cur[j - 1] : t) + j * 0.5; return (1 in cur) + "|" + String(cur[1]) + "|" + Object.keys(cur).length + "|" + cur.join(); }
const n = +process.argv[2] || 3; const given = JSON.parse("[1.5, null, 3]"); let all = ""; for (let t = 0; t < n; t++) { all = ""; for (const g of given) all += f(t, g === null ? 0 / (t - t) : g, t) + "/"; } console.log(all);
