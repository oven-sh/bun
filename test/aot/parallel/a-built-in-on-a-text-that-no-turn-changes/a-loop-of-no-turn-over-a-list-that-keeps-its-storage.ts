const log: string[] = [];
function run(list: string[], q: string): number { let n = 0; for (let i = 0; i < list.length; i++) if (list[i] === q.toLowerCase()) n++; return n; }
(globalThis as any).kept = run;
const list: string[] = JSON.parse('["ab","cd","ab"]');
log.push(String(run(list, "AB")));
list.length = 0;
for (const q of JSON.parse('["AB", null, 7]')) { try { log.push(String(run(list, q))); } catch (e: any) { log.push("THREW WITH NO TURN: " + e.message); } }
console.log(log.join());
