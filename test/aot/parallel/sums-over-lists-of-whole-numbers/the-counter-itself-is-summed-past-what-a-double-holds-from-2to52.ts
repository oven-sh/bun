function sum(n: number, from: number): number { let s = from; for (let i = 0; i < n; i++) s += i; return s; }
console.log(sum(100000000, 2 ** 52));
