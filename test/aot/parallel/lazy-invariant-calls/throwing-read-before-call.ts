// The array is made here, so its elements are proven to be strings or null, and the read of `length` is not guarded: it throws where it stands, in the first iteration, before the call.
// COUNT: operation:operationAOTStringToLowerCase = 0
const list: (string | null)[] = [null, "a", "query"];
function run(q: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i]!.length === q.toLowerCase().length) n++; } return n; }
(globalThis as any).kept = run;
const q: string = JSON.parse('"QUERY"');
for (let round = 0; round < 3; round++) { try { console.log(run(q)); } catch (error: any) { console.log(error.name); } }
