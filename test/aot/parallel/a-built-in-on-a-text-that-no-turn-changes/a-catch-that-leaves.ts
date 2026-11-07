const log: string[] = [];
function run(list: string[], q: string): number { let n = 0; for (let i = 0; i < list.length; i++) { try { log.push("t" + i); if (list[i] === q.toUpperCase()) n++; } catch (e) { log.push("caught"); return -1; } } return n; }
(globalThis as any).kept = run;
const list: string[] = JSON.parse('["AB","CD","AB"]');
for (const q of JSON.parse('["ab", null, "cd", 5]')) log.push(String(run(list, q)));
console.log(log.join());
