"use strict";
function even(n: number, f: (x: number) => number): number { if (n === 0) return f(0); return odd(n - 1, x => x + n); }
function odd(n: number, f: (x: number) => number): number { if (n === 0) return f(1); return even(n - 1, x => x * 2 + n); }
console.log(even(300_000, x => x), odd(300_001, x => x));
