function outer(k: number): (() => number)[] { const a = k, b = k * 2, c = k * 3, d = k * 4; let calls = 0; return [0, 1].map(i => () => sum(i)); function sum(i: number): number { calls++; return a + b + c + d + i + calls; } }
console.log(outer(1).map(f => f()).join(), outer(2).map(f => f() + f()).join());
