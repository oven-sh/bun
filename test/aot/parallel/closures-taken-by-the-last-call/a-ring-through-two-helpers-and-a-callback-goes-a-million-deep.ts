"use strict";
function second(n: number, visit: (x: number) => number): number { return visit(n); }
function first(n: number, visit: (x: number) => number): number { return second(n, visit); }
function maker(n: number, sum: number): number { if (n === 0) return sum; return first(n, x => maker(x - 1, sum + 1)); }
function other(n: number, k: number): number { return first(n, x => x + k); }
console.log(maker(1_000_000, 0), other(1, 2));
