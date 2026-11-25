// The array is declared to hold strings and holds a number and an object in the middle. The specialized loop has made the call by then; the generic version goes on from that iteration.
const list: string[] = JSON.parse('["query","a",7,"query",{"b":1},"query"]');
function run(list: string[], q: string, stop: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === stop) break; if (list[i] === q.toLowerCase()) n++; } return n; }
(globalThis as any).kept = run;
const q: string = JSON.parse('"QUERY"');
for (const stop of ["none", "a", "query"]) console.log(run(list, q, stop), run(JSON.parse('["query","query"]'), q, stop));
