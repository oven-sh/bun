"use strict";
function call(n: number, f: (x: number) => number): number { return f(n); }
function ping(n: number, sum: number): number { if (n === 0) return sum; return call(n, x => pong(x - 1, sum + 1)); }
function pong(n: number, sum: number): number { if (n === 0) return -sum; return call(n, x => ping(x - 1, sum + 2)); }
console.log(ping(1_000_000, 0), pong(999_999, 0));
