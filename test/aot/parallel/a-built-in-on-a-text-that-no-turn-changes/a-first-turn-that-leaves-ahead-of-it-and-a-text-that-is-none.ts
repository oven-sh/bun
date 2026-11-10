const log: string[] = [];
const list: string[] = JSON.parse('["ab","cd","ab","stop","ab"]'), early: string[] = JSON.parse('["stop","ab"]');
function run(list: string[], q: string): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] === "stop") break; if (list[i] === q.toLowerCase()) n++; } return n; }
(globalThis as any).kept = run;
const mine: any = { toLowerCase() { log.push("mine"); return "cd"; } };
for (const rows of [list, early]) for (const q of ["AB", null, 7, mine, "Cd"] as any[]) { try { log.push(String(run(rows, q))); } catch (e: any) { log.push(e.constructor.name + ":" + e.message); } }
console.log(log.join(" | "));
