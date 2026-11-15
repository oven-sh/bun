// The result is carried round the inner loop only. Each run of the inner loop starts without one, so it takes the `q` of its own outer iteration.
// STATISTIC: ResultsCarriedAroundLoops >= 1
const list: string[] = JSON.parse('["one","two","three","two"]');
function run(list: string[], queries: string[], stop: string): number { let found = 0; for (let k = 0; k < queries.length; k++) { const q = String(queries[k]); let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === stop) break; if (list[i] === q.toLowerCase()) n += i + 1; } found = found * 10 + n; } return found; }
(globalThis as any).kept = run;
console.log(run(list, JSON.parse('["TWO","One","THREE","four"]'), "none"));
console.log(run(list, JSON.parse('["TWO","One","THREE","four"]'), "three"));
