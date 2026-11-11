function run(n: number): number { const l = [1, 2]; let s = 0; for (let i = 0; i < n; i++) { for (const k of l) s += k; if (i === 2) (l as any)[Symbol.iterator] = function* () { yield 100; }; } return s; }
console.log(run(0), run(3), run(5));
