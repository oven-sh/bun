// Nothing leaves the loop before the call, so it is hoisted: one call for each time the loop is entered, and none where the loop does not iterate.
// COUNT: operation:operationAOTStringToLowerCase <= 3
const list: string[] = JSON.parse('["query","a","b","query","c","d","e","f"]');
function run(list: string[], q: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === q.toLowerCase()) n++; } return n; }
(globalThis as any).kept = run;
const q: string = JSON.parse('"QUERY"');
for (let round = 0; round < 3; round++) console.log(run(list, q), run([], q));
