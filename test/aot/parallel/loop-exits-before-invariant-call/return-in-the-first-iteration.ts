// The first iteration returns before the call whose operands do not change in the loop.
// COUNT: operation:operationAOTStringToLowerCase = 0
const list: string[] = JSON.parse('["stop","a","b"]');
function run(list: string[], q: string, stop: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === stop) return -1; if (list[i] === q.toLowerCase()) n++; } return n; }
(globalThis as any).kept = run;
const q: string = JSON.parse('"QUERY"');
for (let round = 0; round < 3; round++) console.log(run(list, q, "stop"));
