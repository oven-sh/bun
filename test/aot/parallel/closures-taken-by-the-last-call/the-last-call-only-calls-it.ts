function twice(a: number, f: (x: number) => number): number { let t = a; for (let i = 0; i < 2; i++) t = f(t); return t; }
function last(a: number, k: number) { return twice(a, x => x - k); }
let sum = 0;
for (let i = 0; i < 1000; i++) sum += last(i, i & 3);
console.log(sum);
