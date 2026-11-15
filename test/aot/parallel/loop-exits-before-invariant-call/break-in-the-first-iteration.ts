// The operands of `q.toUpperCase()` do not change in the loop, so the call may be hoisted. But the first iteration leaves before it: the program never makes the call, and its cost has no bound.
// COUNT: operation:operationAOTStringToUpperCase = 0
const list: string[] = JSON.parse('["stop","a","b"]');
function run(list: string[], q: string, stop: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === stop) break; if (list[i] === q.toUpperCase()) n++; } return n; }
(globalThis as any).kept = run;
const q: string = JSON.parse('"query"');
for (let round = 0; round < 3; round++) console.log(run(list, q, "stop"));
