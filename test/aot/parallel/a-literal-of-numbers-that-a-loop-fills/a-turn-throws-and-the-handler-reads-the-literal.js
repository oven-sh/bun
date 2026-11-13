// STATISTIC: ArrayLiteralsAllocatedForLoops = 1
// Under: --aot-check=Validate: the storage that the literal is born with is what every access names
// Under: --aot-harden=proof-checks: what is remembered of the literal is asked of memory
'use strict';
function f(x, t, stop) { let cur; try { cur = 0; const row = [x * 0.5]; cur = row; for (let j = 1; j < 20; j++) { if (j === stop) throw new Error("enough"); row[j] = row[j - 1] + j * 0.5; } return row.length + "|" + row[19]; } catch (e) { return "caught " + cur.length + "|" + cur[0] + "|" + cur[cur.length - 1]; } }
const n = +process.argv[2] || 3; const stops = JSON.parse("[99, 1, 7]"); let all = ""; for (let t = 0; t < n; t++) { all = ""; for (const s of stops) all += f(t + 1.5, t, s) + "/"; } console.log(all);
