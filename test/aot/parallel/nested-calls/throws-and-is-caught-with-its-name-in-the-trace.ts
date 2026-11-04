function outer(x: number): string {
  try { return String(risky(x)); } catch (e) { return (e as Error).message; } finally { done(); }
  function risky(v: number): number { if (v > 1) throw new Error("too much " + v); return v; }
  function done() { count++; }
}
let count = 0;
console.log(outer(1), outer(2), count);
