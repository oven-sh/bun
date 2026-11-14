"use strict";
function until(n: number, f: (x: number) => number): number { if (n > 0) return until(n - 1, f); return f(n); }
function from(n: number, k: number): number { return until(n, x => x + k); }
function also(n: number, k: number): number { return until(n, x => x - k); }
console.log(from(1_000_000, 5), also(1_000_000, 5));
