// The call stands in a small function that the loop inlines, after a `throw` that the first iteration takes.
// COUNT: operation:operationAOTStringToLowerCase = 0
const list: string[] = JSON.parse('["stop","a","b"]');
function same(item: string, q: string, stop: string): boolean { if (item === stop) throw new RangeError("stopped"); return item === q.toLowerCase(); }
function run(list: string[], q: string, stop: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (same(list[i], q, stop)) n++; } return n; }
(globalThis as any).kept = run;
const q: string = JSON.parse('"QUERY"');
for (let round = 0; round < 3; round++) { try { console.log(run(list, q, "stop")); } catch (error: any) { console.log(error.name); } }
