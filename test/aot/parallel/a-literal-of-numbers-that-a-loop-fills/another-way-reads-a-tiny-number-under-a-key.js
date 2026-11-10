// STATISTIC: ArrayLiteralsAllocatedForLoops = 0
// Under: --aot-check=Validate: an access named a kind of storage that the maker of its list was not born with any more
'use strict';
function f(x, fills, k) { const a = [x * 1]; if (fills) { for (let i = 1; i < 30; i++) a[i] = i * 0.5 + x; return a; } return a[k & 1]; }
const n = +process.argv[2] || 3; const flags = JSON.parse("[true,false,false]"), keys = JSON.parse("[0,0,1]"); const tiny = JSON.parse("65536") * Number.MIN_VALUE; let all = ""; for (let t = 0; t < n; t++) { all = ""; for (let c = 0; c < 3; c++) { const got = f(tiny, flags[c], keys[c]); all += typeof got + " " + (typeof got === "object" ? got.length : got) + "/"; } } console.log(all);
