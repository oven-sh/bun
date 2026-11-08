"use strict";
const steps: Array<(n: number, sum: number) => number> = [];
function helper(n: number, callback: (x: number) => number): number { return callback(n); }
function maker(n: number, sum: number): number { if (n === 0) return sum; return helper(n, x => steps[x & 1](x - 1, sum + 1)); }
function other(n: number, k: number): number { return helper(n, x => x * k); }
steps.push(maker, maker);
console.log(maker(1_000_000, 0), other(3, 4));
