// A `continue` goes past the call: that back edge passes on what its iteration entered with, and the next iteration that reaches the call makes it if it must.
// STATISTIC: ResultsCarriedAroundLoops >= 1
const list: string[] = JSON.parse('["skip","query","skip","b","query"]');
function run(list: string[], q: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === "skip") continue; if (list[i] === q.toLowerCase()) n++; } return n; }
(globalThis as any).kept = run;
console.log(run(list, JSON.parse('"QUERY"')), run(list, JSON.parse('"B"')));
