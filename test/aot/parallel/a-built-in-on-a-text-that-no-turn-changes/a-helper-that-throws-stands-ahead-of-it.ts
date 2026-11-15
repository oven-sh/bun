const log: string[] = [];
function check(i: number, limit: number): number { if (i >= limit) throw new RangeError("limit " + i); return i; }
function run(list: string[], q: string, limit: number): number { let n = 0; for (let i = 0; i < list.length; i++) { check(i, limit); if (list[i] === q.trim()) n++; } return n; }
(globalThis as any).kept = run;
const list: string[] = JSON.parse('["ab","cd","ab"]');
for (const limit of [9, 0, 2]) for (const q of JSON.parse('[" ab ", null, {}, "cd"]')) { try { log.push(String(run(list, q, limit))); } catch (e: any) { log.push(e.constructor.name + ":" + e.message); } }
console.log(log.join(" | "));
