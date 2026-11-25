// The loop condition has two tests. Only the first is the header's own; the second one fails at once, so no iteration begins and the call is never made.
// COUNT: operation:operationAOTStringToLowerCase = 0
const list: string[] = JSON.parse('["stop","a","b"]');
function run(list: string[], q: string, stop: string): number { let n = 0; for (let i = 0; i < list.length && list[i] !== stop; i++) { if (list[i] === q.toLowerCase()) n++; } return n; }
(globalThis as any).kept = run;
const q: string = JSON.parse('"QUERY"');
for (let round = 0; round < 3; round++) console.log(run(list, q, "stop"));
