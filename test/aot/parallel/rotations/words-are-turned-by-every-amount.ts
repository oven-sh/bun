function turn(x: number, n: number): number { return (x << n) | (x >>> (32 - n)); }
function by1(x: number): number { return (x << 1) | (x >>> 31); }
function by8(x: number): number { return (x >>> 24) | (x << 8); }
function by16(x: number): number { return (x << 16) ^ (x >>> 16); }
function by31(x: number): number { return (x >>> 1) | (x << 31); }
function unsigned(x: number): number { return ((x << 13) | (x >>> 19)) >>> 0; }
function twice(x: number): number { const y = (x << 3) | (x >>> 29); return (y << 29) | (y >>> 3); }
function over(x: number): number { return (x << 37) | (x >>> 27); }
function md(a: number, b: number, c: number, d: number, w: number): number { const t = (a + ((b & c) | (~b & d)) + w + 0xd76aa478) | 0; return (((t << 7) | (t >>> 25)) + b) | 0; }
const words = [0, 1, -1, 2, 0x7fffffff, 0x80000000, 0x80000001, 0xdeadbeef, 0x12345678, 0xffff0000, 4294967295, 4294967296, 1.5, -1.5, NaN, Infinity];
for (const x of words) {
  console.log(x, by1(x), by8(x), by16(x), by31(x), unsigned(x), twice(x), over(x), md(x, ~x, x >>> 3, x << 3, 7));
  let all = "";
  for (let n = 0; n <= 32; n++) all += turn(x, n) + ",";
  console.log(all);
}
let h = 0x811c9dc5 | 0;
for (let i = 0; i < 100000; i++) h = (((h << 5) | (h >>> 27)) ^ i) | 0;
console.log(h);
