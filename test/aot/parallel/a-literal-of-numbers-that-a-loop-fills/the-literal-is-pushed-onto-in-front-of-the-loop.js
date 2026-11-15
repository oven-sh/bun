// STATISTIC: ArrayLiteralsAllocatedForLoops = 0
// Under: --aot-harden=proof-checks: the raise asks at the run what the walk has shown: the position is the length and lies below the room
'use strict';
function f(t) { const a = [t + 0.5]; a.push(1.5, 2.5, 3.5, 4.5); let s = 0; for (let i = 1; i < 30; i++) { s = s * 2 % 1000003 + a.length; a[i] = i * 0.5; } return s + "|" + a.length + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
