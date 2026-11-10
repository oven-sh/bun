function ofList(s: number[]): void {
  let a = s[0]!, b = s[1]!, c = s[2]!, d = s[3]!;
  for (let i = 0; i < 64; i++) { const t = (((a << 5) | (a >>> 27)) + ((b & c) ^ d) + i) | 0; d = c; c = (b << 30) | (b >>> 2); b = a; a = t; }
  s[0] = (s[0]! + a) >>> 0; s[1] = ((s[1]! + b) | 0x80000000) >>> 0; s[2] = (s[2]! + c) >>> 0; s[3] = (s[3]! + d) >>> 0;
}
function ofView(s: Uint32Array): void {
  let a = s[0]!, b = s[1]!, c = s[2]!, d = s[3]!;
  for (let i = 0; i < 64; i++) { const t = (((a << 5) | (a >>> 27)) + ((b & c) ^ d) + i) | 0; d = c; c = (b << 30) | (b >>> 2); b = a; a = t; }
  s[0] = s[0]! + a; s[1] = ((s[1]! + b) | 0x80000000) >>> 0; s[2] = s[2]! + c; s[3] = s[3]! + d;
}
function ofPattern(s: Uint32Array): void {
  let [a, b, c, d] = s as unknown as [number, number, number, number];
  for (let i = 0; i < 64; i++) { const t = (((a << 5) | (a >>> 27)) + ((b & c) ^ d) + i) | 0; d = c; c = (b << 30) | (b >>> 2); b = a; a = t; }
  s[0] = s[0]! + a; s[1] = ((s[1]! + b) | 0x80000000) >>> 0; s[2] = s[2]! + c; s[3] = s[3]! + d;
}
function run(xs: number[], n: number): string { let a = xs[0]!, b = xs[1]!; for (let i = 0; i < n; i++) { const t = (a + b) | 0; b = a; a = t; } return a + "," + b; }
function last(xs: number[], n: number): number { let a = xs[0]!; for (let i = 0; i < n; i++) a = (a + 1) | 0; return a; }
function not(xs: number[], n: number): string { let e = xs[0]!, g = xs[1]!; for (let i = 0; i < n; i++) { const t = ((~e & g) + (e >>> 3) + i) | 0; g = e; e = t; } return e + "," + g; }
function mixed(xs: unknown[], n: number): string { let a = xs[0] as number, b = xs[1] as number; for (let i = 0; i < n; i++) { const t = (a ^ b) | 0; b = a; a = t; } return String(a) + "," + String(b); }
const scale = process.argv.length > 9 ? 0.5 : 1;
const words = [0x67452301 * scale, 0xefcdab89 * scale, 0x98badcfe * scale, 0x10325476 * scale];
for (let k = 0; k < 40; k++) ofList(words);
console.log(words.join());
const view = Uint32Array.of(0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476);
for (let k = 0; k < 40; k++) ofView(view);
console.log(view.join());
const other = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
for (let k = 0; k < 40; k++) ofPattern(other);
console.log(other.join());
console.log(run([4294967295, 1], 0), run([4294967295, 1], 1), run([4294967295, 1], 2), run([0.5, 0.5], 1), run([2 ** 32, 1], 1), run([2 ** 53, 1], 1), run([-2147483649, -1], 1), run([NaN, 1], 1), Object.is(last([-0], 0), -0), last([-0], 1));
console.log(run([-2147483648, 4294967295], 0), run([-2147483648, 4294967295], 1), run([-2147483648, 4294967295], 5), run([Infinity, -Infinity], 1), run([4294967295.5, 0], 1), last([4294967295], 0), last([4294967295], 1), last([2147483647], 1));
console.log(not([4294967295, 2863311530], 0), not([4294967295, 2863311530], 1), not([4294967295, 2863311530], 7), not([2147483648, 1], 3), not([-1, -2], 3));
console.log(mixed([4294967295, 1], 2), mixed(["7", 1], 2), mixed([undefined, 4294967295], 1), mixed([null, 3000000000], 0), mixed([true, 3000000000], 3), mixed([{ valueOf() { return 4000000000; } }, 1], 2));
