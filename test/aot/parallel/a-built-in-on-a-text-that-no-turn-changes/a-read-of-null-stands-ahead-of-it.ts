type Row = { name: string };
const log: string[] = [];
function run(rows: Row[], q: string): number { let n = 0; for (let i = 0; i < rows.length; i++) { const name = rows[i].name; if (name === q.toLowerCase()) n++; } return n; }
(globalThis as any).kept = run;
const good: Row[] = JSON.parse('[{"name":"ab"},{"name":"cd"},{"name":"ab"}]'), bad: Row[] = JSON.parse('[null,{"name":"ab"}]');
for (const rows of [good, bad]) for (const q of JSON.parse('["AB", null, 7, "Cd"]')) { try { log.push(String(run(rows, q))); } catch (e: any) { log.push(e.constructor.name + ":" + e.message); } }
console.log(log.join(" | "));
