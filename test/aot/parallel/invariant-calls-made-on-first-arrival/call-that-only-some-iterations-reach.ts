// A `continue` goes past the call, so a back edge would have no result to carry. The call stays where it is.
// STATISTIC: ResultsCarriedAroundLoops = 0
const list: string[] = JSON.parse('["skip","query","skip","b","query"]');
function run(list: string[], q: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === "skip") continue; if (list[i] === q.toLowerCase()) n++; } return n; }
(globalThis as any).kept = run;
console.log(run(list, JSON.parse('"QUERY"')), run(list, JSON.parse('"B"')));
