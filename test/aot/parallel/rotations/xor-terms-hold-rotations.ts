// Shifts that make up rotations stand apart in a chain of xor or or, as the functions of SHA-256 write them.
function S0(x: number): number { return x >>> 2 ^ x >>> 13 ^ x >>> 22 ^ x << 30 ^ x << 19 ^ x << 10; }
function S1(x: number): number { return x >>> 6 ^ x >>> 11 ^ x >>> 25 ^ x << 26 ^ x << 21 ^ x << 7; }
function s0(x: number): number { return x >>> 7 ^ x >>> 18 ^ x >>> 3 ^ x << 25 ^ x << 14; }
function s1(x: number): number { return x << 15 ^ x >>> 17 ^ x << 13 ^ x >>> 10 ^ x >>> 19; }
function ors(x: number, y: number): number { return x << 5 | y | x >>> 27 | y << 9 | y >>> 23; }
function mixed(x: number, y: number): number { return (x << 5 | y) ^ x >>> 27; }
function signed(x: number, y: number): number { return x << 5 ^ y ^ x >> 27; }
function short(x: number, y: number): number { return x << 5 ^ y ^ x >>> 26; }
function same(x: number): number { return x >>> 8 ^ x << 24 ^ x >>> 8 ^ x << 24; }
function kept(x: number): number { const t = x >>> 8 ^ x >>> 16; return (t ^ x << 24) + t; }
const words = [0, 1, -1, 2, 0x7fffffff, 0x80000000, 0x80000001, 0xdeadbeef, 0x12345678, 0xffff0000, 4294967295, 4294967296, 1.5, -1.5, NaN, Infinity];
for (const x of words)
  console.log(x, S0(x), S1(x), s0(x), s1(x), ors(x, ~x), mixed(x, x >>> 3), signed(x, ~x), short(x, x << 3), same(x), kept(x));
let h = 0x811c9dc5 | 0, all = 0;
for (let i = 0; i < 100000; i++) { h = (S0(h) + S1(i) + s0(h ^ i) ^ s1(h)) | 0; all ^= ors(h, i); }
console.log(h, all);
