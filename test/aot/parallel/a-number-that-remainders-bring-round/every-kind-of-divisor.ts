function ring(n: number, d: number): number { let h = 0; for (let i = 0; i < n; i++) h = (h + 3) % d; return h; }
console.log(ring(5, 8), ring(3, 0), ring(5, -8), ring(4, 2.5), ring(2, -1), ring(3, Infinity), ring(2, NaN), ring(0, 8), ring(4, 1), ring(3, 2 ** 31), ring(3, 2 ** 32), ring(1, -0));
