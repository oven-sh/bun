"use strict";
function helper(n: number, callback: (x: number) => number = x => (x > 0 ? maker(x - 1, false) : -1)): number { return callback(n); }
function maker(n: number, own: boolean): number { return own ? helper(n, x => x + 100) : helper(n); }
console.log(maker(1_000_000, false), maker(5, true), helper(0, undefined));
