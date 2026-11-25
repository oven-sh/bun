const log: string[] = [];
const holder = { get first(): string { log.push("get"); return "ab"; } };
const mine: any = { toLowerCase() { log.push("mine"); return "ab"; }, slice() { log.push("cut"); return "ab"; } };
function run(turns: number, q: string): number { let n = 0; for (let i = 0; i < turns; i++) { const a = holder.first; if (a === q.toLowerCase() || a === q.slice(0, 2)) n++; } return n; }
(globalThis as any).kept = run;
for (const q of ["AB", mine, "abX", mine]) log.push(String(run(2, q)));
console.log(log.join());
