function last(f: (x: number) => number, x: number): number { return f(x); }
function risky(k: number): number { return last(x => { if (x > 2) throw new Error("over " + (x + k)); return x + k; }, k); }
function safe(k: number): number { return last(x => x - k, k + 1); }
const out: string[] = [];
for (let i = 0; i < 5; i++) { try { out.push(String(risky(i) + safe(i))); } catch (e) { out.push((e as Error).message); } }
console.log(out.join());
