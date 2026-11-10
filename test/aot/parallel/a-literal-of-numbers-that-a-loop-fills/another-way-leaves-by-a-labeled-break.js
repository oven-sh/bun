// STATISTIC: ArrayLiteralsAllocatedForLoops = 0
// Under: --aot-check=Validate: an access named a kind of storage that the maker of its list was not born with any more
'use strict';
function f(t, fills, k) { const a = [t | 0, 9]; out: { if (!fills) break out; for (let i = 2; i < 30; i++) a[i] = i * 0.5 + t; return a; } return a[k & 1]; }
const n = +process.argv[2] || 3; const flags = JSON.parse("[true,false,false]"), keys = JSON.parse("[0,0,1]"); let all = ""; for (let t = 0; t < n; t++) { all = ""; for (let c = 0; c < 3; c++) all += String(f(t + 5, flags[c], keys[c])) + "/"; } console.log(all);
