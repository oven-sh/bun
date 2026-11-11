// STATISTIC: IndexedStoresCompiledAsAppends >= 1
// Under: --aot-harden=proof-checks: the raise asks at the run what the walk has shown: the position is the length and lies below the room
'use strict';
function g(n, t) { let prev = [t]; for (let j = 1; j <= n; j++) prev[j] = j; for (let i = 1; i <= 6; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + ((i ^ j) & 1)); prev = cur; } return prev.length + "|" + prev.join(); } function f(t) { return g(9, t) + "/" + g(0, t) + "/" + g(30, t); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
