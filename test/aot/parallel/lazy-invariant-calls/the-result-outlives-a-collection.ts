// The loop runs other code after the call, which collects. The string that is carried round has no other holder.
// STATISTIC: ResultsCarriedAroundLoops >= 1
const list: string[] = JSON.parse('["a","a long enough query, in lower case","b","a long enough query, in lower case"]');
function run(list: string[], q: string, stop: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === stop) break; if (list[i] === q.toLowerCase()) n++; Bun.gc(true); } return n; }
(globalThis as any).kept = run;
const q: string = JSON.parse('"A Long Enough Query, In Lower Case"');
for (let round = 0; round < 3; round++) console.log(run(list, q, "none"));
