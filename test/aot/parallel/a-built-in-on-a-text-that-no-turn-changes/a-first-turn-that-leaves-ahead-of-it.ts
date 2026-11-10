const log: string[] = [];
function run(list: string[], q: string, stop: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === stop) break; if (list[i] === q.substring(1)) n++; } return n; }
(globalThis as any).kept = run;
const list: string[] = JSON.parse('["ab","cd","ab"]');
for (const stop of ["zz", "ab", "cd"]) for (const q of JSON.parse('["xab", null, 7]')) { try { log.push(String(run(list, q, stop))); } catch (e: any) { log.push(e.constructor.name); } }
console.log(log.join());
