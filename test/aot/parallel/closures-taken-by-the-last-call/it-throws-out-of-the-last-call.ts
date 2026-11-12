function run(f: () => number): number { return f() + 1; }
function risky(k: number): number { return run(() => { if (k > 2) throw new Error("over " + k); return k; }); }
const out: string[] = [];
for (let i = 0; i < 5; i++) { try { out.push(String(risky(i))); } catch (e) { out.push((e as Error).message); } }
console.log(out.join());
