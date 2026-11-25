"use strict";
function helper(n: number, callback: (x: number) => number): number { return callback(n); }
function maker(n: number, sum: number): number { if (n === 0) return sum; return helper(n, x => maker(x - 1, sum + (x & 3))); }
function other(n: number, k: number): number { return helper(n, x => x + k); }
console.log(maker(1_000_000, 0), other(1, 2));
