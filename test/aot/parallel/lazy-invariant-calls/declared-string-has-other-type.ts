// `q` is declared a string and is something else: an object with a method of its own, which must run in every iteration, a number, null.
const list: string[] = JSON.parse('["a","query","b"]');
let calls = 0;
function run(list: string[], q: string, stop: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === stop) break; if (list[i] === q.toLowerCase()) n++; } return n; }
(globalThis as any).kept = run;
const own: any = { toLowerCase() { calls++; return "query"; } };
for (const q of ["QUERY", own, 7, null, new String("QUERY")] as any[]) { try { console.log(run(list, q, "none"), calls); } catch (error: any) { console.log(error.name, calls); } }
