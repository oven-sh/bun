// No statement leaves the loop, but the read of `name` off null throws in the first iteration, before the call.
// COUNT: operation:operationAOTStringToLowerCase = 0
type Item = { name: string };
const list: Item[] = JSON.parse('[null,{"name":"a"}]');
function run(list: Item[], q: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i].name === q.toLowerCase()) n++; } return n; }
(globalThis as any).kept = run;
const q: string = JSON.parse('"QUERY"');
for (let round = 0; round < 3; round++) { try { console.log(run(list, q)); } catch (error: any) { console.log(error.name); } }
