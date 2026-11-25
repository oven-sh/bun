"use strict";
function helper(n: number, callback: (x: number) => number): number { if (n > 0) callback = x => maker(x - 1); return callback(n); }
function maker(n: number): number { return helper(n, x => x + 100); }
console.log(maker(1_000_000));
