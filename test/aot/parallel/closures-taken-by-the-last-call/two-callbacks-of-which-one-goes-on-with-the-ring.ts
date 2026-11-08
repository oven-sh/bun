"use strict";
function pick(n: number, stop: (x: number) => number, go: (x: number) => number): number { if (n <= 0) return stop(n); return go(n); }
function down(n: number, sum: number): number { return pick(n, () => sum, x => down(x - 1, sum + (x & 3))); }
function both(n: number, k: number): number { return pick(n, x => x - k, x => x + k); }
console.log(down(1_000_000, 0), both(0, 5), both(7, 5));
