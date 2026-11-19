// A `break` comes before `q.toLowerCase()`, so the call may not be hoisted. The first iteration that gets to it makes it, and the others take its result.
// STATISTIC: ResultsCarriedAroundLoops >= 1
// COUNT: operation:operationAOTStringToLowerCase <= 3
const list: string[] = JSON.parse('["a","query","b","c","query","d","e","f"]');
function run(list: string[], q: string, stop: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === stop) break; if (list[i] === q.toLowerCase()) n++; } return n; }
(globalThis as any).kept = run;
const q: string = JSON.parse('"QUERY"');
for (const stop of ["none", "c", "a"]) console.log(run(list, q, stop), run([], q, stop));
