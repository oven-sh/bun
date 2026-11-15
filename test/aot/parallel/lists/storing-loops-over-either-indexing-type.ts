// Loops that store into an array and read others below a bound of their own: each read array holds whole numbers, fractions, holes, undefined, or is the array that is stored into.
// An element that an outer loop reads is a number once, whatever the inner loop does with it.
// STATISTIC: UnrolledLoopsForIndexingType >= 4
const T = JSON.parse("40") as number, log: number[] = [];
function scaled(out: number[], a: number[], f: number, n: number): void { for (let j = 0; j < n; j++) out[j] += f * a[j]; }
function products(out: number[], a: number[], b: number[], n: number): void { for (let j = 0; j < n; j++) out[j] = a[j] * b[j]; }
function rows(out: number[], m: number[][], k: number, f: number, n: number): void { for (let j = 0; j < n; j++) out[j] += f * m[k][j]; }
function bits(out: number[], a: number[], b: number[], n: number): void { for (let j = 0; j < n; j++) out[j] = a[j] ^ b[j]; }
function outer(out: number[], a: number[], b: number[], n: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]; for (let j = 0; j < n; j++) out[j] += x * b[j]; } }
function less(out: number[], a: number[], b: number[], n: number): void { for (let i = 0; i < a.length; i++) { const x = a[i]; for (let j = 0; j < n; j++) if (x < b[j]) out[j]++; } }
function multiply(a: number[][], b: number[][]): number[][] {
  const n = a.length, result: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(n).fill(0);
    for (let k = 0; k < n; k++) { const factor = a[i][k]; for (let j = 0; j < n; j++) row[j] += factor * b[k][j]; }
    result.push(row);
  }
  return result;
}
const makers: Record<string, () => any> = {
  ints: () => Array.from({ length: 19 }, (_, i) => i - 5), doubles: () => Array.from({ length: 19 }, (_, i) => i * 1.25 - 2),
  zeros: () => [0, -0, 0, -0, 1, -1, 0, -0, NaN, 0, -0, Infinity, -Infinity, 0, 2147483647, -2147483648, 4294967296, 0.1, -0],
  holes: () => [1, 2, , 4, 5, 6, 7, 8, 9, 10, , 12, 13, 14, 15, 16, 17, 18, 19], fractions: () => [0.5, 1.5, , 4.5, 5.5, 6, 7, 8, 9, 10, , 12, 13.5, 14, 15, 16, 17, 18, 19],
  missing: () => [1, 2, undefined, 4, 5, 6, 7, 8, 9, 10, 11, undefined, 13, 14, 15, 16, 17, 18, 19], texts: () => [1, 2, 3, "4", 5, 6, 7, 8, 9, "x", 11, 12, 13, 14, 15, 16, 17, 18, 19],
  objects: () => [1, 2, 3, { valueOf() { log.push(1); return 4; } }, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], short: () => [1, 2, 3, 4, 5], none: () => [],
  frozen: () => Object.freeze(Array.from({ length: 19 }, (_, i) => i)), getter: () => Object.defineProperty(Array.from({ length: 19 }, (_, i) => i), 3, { get() { log.push(2); return 0.75; } }), far: () => { const list = [1.5, 2]; list[90] = 1; return list; },
};
const show = (v: unknown): string => Object.is(v, -0) ? "-0" : String(v);
const names = Object.keys(makers);
for (let t = 0; t < T; t++) {
  for (const first of names) for (const second of names) {
    const a = makers[first](), b = makers[second](), out = new Array(19).fill(t % 3 === 1 ? 0.5 : 0), said: string[] = [];
    const target = t % 5 === 4 ? b : out, n = t % 4 === 3 ? 22 : t % 7 === 5 ? 3 : 19;
    for (const run of [() => scaled(target, a, b[2], n), () => products(target, a, b, n), () => rows(target, [a, b, []], t % 3, a[1], n), () => bits(target, a, b, n), () => outer(target, a, b, n), () => less(target, a, b, n)]) {
      try { run(); } catch (error) { said.push((error as Error).constructor.name); }
    }
    if (t === 3 || t === 4 || t === T - 1) console.log(t, first, second, out.map(show).join(), Array.from(b, show).join(), said.join(), 2 in b, 10 in a);
  }
}
for (let t = 0; t < T; t++) {
  const size = t % 3 ? 11 : 3, a: number[][] = [], b: number[][] = [];
  for (let i = 0; i < size; i++) { a.push(Array.from({ length: size }, (_, k) => (i * 7 + k * 3 + t) % 10 / (t & 1 ? 1 : 4))); b.push(Array.from({ length: size }, (_, k) => (i * 5 + k * 11 + t) % 13 / (t & 2 ? 1 : 8))); }
  if (t % 5 === 0) delete b[1][2];
  if (t % 7 === 0) (b[2] as any)[1] = undefined;
  if (t % 11 === 0) (a[1] as any)[0] = undefined;
  console.log(multiply(a, b).map(row => row.map(show).join()).join(" "));
}
console.log(log.length);
