function run(n: number, stop: number): string {
  const l = [1, 2, 3]; let s = 0;
  try { outer: for (let i = 0; i < n; i++) for (const k of l) { if (k === 2 && i === 1) continue; if (k === 3 && i === 2) continue outer; if (k + i === stop) break outer; if (k * i === 12) return "returned " + s; if (k * i === 15) throw new Error("thrown " + s); s += k; } } catch (e) { return (e as Error).message; }
  return "whole " + s;
}
console.log(run(0, 99), run(3, 99), run(9, 4), run(9, 99), run(4, 99), run(9, 7));
