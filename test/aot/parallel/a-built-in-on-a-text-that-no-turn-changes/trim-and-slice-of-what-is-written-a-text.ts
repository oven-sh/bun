const log: string[] = [];
const list: string[] = JSON.parse('["ab","cd","ab"]');
function run(q: string, a: number, b: number): number { let n = 0; for (let i = 0; i < list.length; i++) if (list[i] === q.trim() || list[i] === q.slice(a, b) || list[i] === q.trimEnd() || list[i] === q.trimStart() || list[i] === q.substring(a, b) || list[i] === q.substr(a, b) || list[i] === q.toUpperCase()) n++; return n; }
(globalThis as any).kept = run;
let asked = 0;
const from: any = { valueOf() { asked++; return 1; } };
for (const q of [" ab ", "xcdx", null, 5, "ab  ", "  cd"] as any[]) for (const a of [1, from, -3, 1.5, undefined] as any[]) { try { log.push(String(run(q, a, 3))); } catch (e: any) { log.push(e.constructor.name); } }
console.log(log.join(), asked);
