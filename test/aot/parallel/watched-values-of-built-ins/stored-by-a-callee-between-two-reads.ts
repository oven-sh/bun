// stored by a callee between two reads
const k: string = JSON.parse('"env"');
const p: any = process;
const seen: unknown[] = [];
const first = process.env;
function look() { seen.push(process.env === first, typeof process.env, (process.env as any)?.WATCHED); }
function deed(i: number) { if (i === 2) p[k] = { WATCHED: "by a callee" }; }
function both(i: number) { const a = process.env; deed(i); const b = process.env; return a === b; }
for (let i = 0; i < 5; i++) seen.push(both(i));
console.log(seen.join());
