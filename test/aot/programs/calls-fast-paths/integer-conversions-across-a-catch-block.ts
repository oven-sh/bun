// `x | 0` on sums, differences and quotients, and `Math.floor(x / y)` and the like, where a `catch` block lies between computing the value and using it.
declare const console: any;
const said: string[] = [];
function block(name: string, body: () => unknown) { calls = 0; try { said.push(name + ": " + body()); } catch (error) { said.push(name + ": THROWS " + String(error)); } }
let calls = 0, every = 3;
function churn(x: number, depth: number): number {
  let a = x + 1, b = x + 2, c = x + 3, d = x + 4, e = x + 5, f = x + 6, g = x + 7, h = x + 8, i = x + 9, j = x + 10, k = x * 1.5, l = x * 2.5, m = x * 3.5, n = x * 4.5;
  for (let t = 0; t < 2; t++) { a += b ^ t; b += c & 31; c += d | 1; d += e ^ a; e += f & b; f += g | c; g += h ^ d; h += i & e; i += j | f; j += a ^ g; k += l * 0.5; l += m * 0.25; m += n * 0.125; n += k * 0.0625; }
  if (depth) return churn(a & 63, depth - 1) + b + c + d + e + f + g + h + i + j + k + l + m + n;
  if (x >= 0) throw "thrown";
  return a + b + c + d + e + f + g + h + i + j + k + l + m + n;
}
function mayThrow(): void { if (every && ++calls % every === 0) churn(calls & 63, 3); }
function sum(n: number): number { let t = 1; for (let i = 0; i < n; i++) { t += i * 3; try { mayThrow(); } catch {} t ^= i + 1; } return t; }
function difference(n: number): number { let t = 100000; for (let i = 0; i < n; i++) { t -= i * 7; try { mayThrow(); } catch {} t |= i; } return t; }
function sumOfFractions(n: number): number { let t = 0.5; for (let i = 0; i < n; i++) { t += i * 3; try { mayThrow(); } catch {} t ^= i + 1; t += 0.25; } return t; }
function quotient(n: number, d: number): number { let s = 0; for (let i = 1; i <= n; i++) { const q = (i * 10) / d; try { mayThrow(); } catch {} s += q | 0; } return s; }
function floored(n: number, d: number): number { let s = 0; for (let i = 1; i <= n; i++) { const q = (i * 10 - 35) / d; try { mayThrow(); } catch {} s += Math.floor(q); } return s; }
function ceiled(n: number, d: number): number { let s = 0; for (let i = 1; i <= n; i++) { const q = (i * 10 - 35) / d; try { mayThrow(); } catch {} s += Math.ceil(q); } return s; }
function rounded(n: number, d: number): number { let s = 0; for (let i = 1; i <= n; i++) { const q = (i * 10 - 35) / d; try { mayThrow(); } catch {} s += Math.round(q); } return s; }
function truncated(n: number, d: number): number { let s = 0; for (let i = 1; i <= n; i++) { const q = (i * 10 - 35) / d; try { mayThrow(); } catch {} s += Math.trunc(q); } return s; }
function truncatedToInt32(n: number, x: number): number { let s = 0; for (let i = 1; i <= n; i++) { const q = Math.trunc(x * i + 0.5); try { mayThrow(); } catch {} s ^= q; } return s; }
function truthOfACast(n: number): number { let c = 0; for (let i = 0; i < n; i++) { const a = i % 3; const v = a && i * 2; try { mayThrow(); } catch {} if (v) c++; } return c; }
function once(x: number, y: number): number { const s = x + y * 3; try { mayThrow(); } catch {} return s ^ 5; }
function onceInTheHandler(x: number, y: number): number { const s = x + y * 3; try { mayThrow(); return -1; } catch { return s ^ 5; } }
function onceOfAQuotient(x: number, y: number): number { const q = (x * 10) / y; try { mayThrow(); } catch {} return (q | 0) + Math.floor(q) * 100; }
for (const [how, k] of [["never", 0], ["every third", 3], ["every second", 2], ["always", 1]] as [string, number][]) {
  every = k;
  block("a sum, " + how, () => [sum(5), sum(50), sum(500)].join());
  block("a difference, " + how, () => [difference(5), difference(50)].join());
  block("a sum of fractions, " + how, () => [sumOfFractions(5), sumOfFractions(50)].join());
  block("a quotient, " + how, () => [quotient(20, 3), quotient(20, 7), quotient(5, 0)].join());
  block("floor, ceil, round, trunc, " + how, () => [floored(20, 3), ceiled(20, 3), rounded(20, 4), truncated(20, 3)].join());
  block("Math.trunc to int32, " + how, () => [truncatedToInt32(20, 1.75), truncatedToInt32(20, 1e9)].join());
  block("the truth of a cast, " + how, () => [truthOfACast(10), truthOfACast(31)].join());
  block("once, " + how, () => [once(1, 2), once(2 ** 40, 3), once(0.5, 4), onceInTheHandler(7, 8), onceOfAQuotient(7, 2)].join());
}
console.log(said.join("\n"));
export {};
