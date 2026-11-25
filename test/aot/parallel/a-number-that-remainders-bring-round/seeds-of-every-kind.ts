function walk(x: number, n: number): number { for (let i = 0; i < n; i++) x = (x * 3 + 1) % 16; return x; }
console.log(walk(5, 2), walk(0.5, 2), walk(-1, 1), walk(-1, 2), walk(NaN, 2), walk(Infinity, 1), walk(2 ** 53, 1), walk(-0, 1), walk(2 ** 31, 1), walk(16, 0));
