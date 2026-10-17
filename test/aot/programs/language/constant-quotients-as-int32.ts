// A division of two constants whose quotient is taken as an int32: shifted by a count that is only known at run time, used as a count, masked, or dropped.
declare const console: { log(...values: unknown[]): void };
const small: number[] = [10, 11, 12, 13, 14, 15, 16, 17];
function a(): number { return (2 / 2) >> small.length; }
function b(): number { return (2 / 2) >> Math.trunc(small.length / 2); }
function c(): void { let v = (2 / 2) >> Math.trunc(small.length / 2); }
function d(): number { return (1000 / 3) >> (small.length - 6); }
function e(): number { return (-1000 / 3) >> (small.length - 6); }
function f(): number { return (1000 / 3) << (small.length - 6); }
function g(): number { return (-1000 / 3) >>> (small.length + 16); }
function h(): number { return small.length >> (8 / 4); }
function i(): number { return ((7 / 2) | 0) + ((-7 / 2) | 0) + ((7 / -2) | 0) + ((0 / 5) | 0) + ((-0 / 5) | 0); }
function j(): number { return ((4294967296 / 2) | 0) + ((4294967295 / 1) | 0) + ((9007199254740991 / 3) | 0) + ((-4294967297 / 1) | 0); }
function k(): number { return ((1 / 0) | 0) + ((-1 / 0) | 0) + ((0 / 0) | 0); }
function l(): number { return ((6 / 3) & small.length) + ((6 / 4) ^ small.length) + (~(9 / 2)); }
function m(n: number): number { return (12 / 4) >> n; }
function o(n: number): number { return (n / 4) >> (12 / 4); }
const fns: (() => number | void)[] = [a, b, c, d, e, f, g, h, i, j, k, l];
console.log(fns.map(x => String(x())).join(" "));
const taking = [m, o]; console.log(taking.map(x => [0, 1, 2, 31, 32, 33, -1, 1.5, 1e21, NaN].map(n => x(n)).join()).join(" "));
