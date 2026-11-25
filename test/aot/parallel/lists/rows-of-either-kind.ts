// A row that one stretch of a turn reads and stores into has an arm for doubles and one for int32s; tables that are known to hold numbers may hold either.
// STATISTIC: RowStoresOfEitherKind >= 4
function count(o: number[][], n: number): number {
  for (let i = 0; i < n; i++) o[i & 3][(i * 7) & 3]++;
  return o[3][1];
}
function add(o: number[][], n: number, v: number): number {
  for (let i = 0; i < n; i++) o[(i * 5) & 3][i & 3] += v;
  return o[1][1];
}
function lower(o: number[][], n: number): number {
  for (let i = 0; i < n; i++) o[i & 3][i & 3]--;
  return o[2][2];
}
function scale(o: number[][], n: number, v: number): number {
  for (let i = 0; i < n; i++) o[i & 3][(i >> 2) & 3] *= v;
  return o[0][0];
}
function mask(o: number[][], n: number): number {
  for (let i = 0; i < n; i++) o[i & 3][(i >> 2) & 3] ^= i;
  return o[0][0];
}
function distance(s: string, t: string, cost: number): number {
  const d: number[][] = [];
  for (let i = 0; i <= s.length; i++) d.push(new Array<number>(t.length + 1).fill(0));
  for (let i = 0; i <= s.length; i++) d[i][0] = i * cost;
  for (let j = 0; j <= t.length; j++) d[0][j] = j * cost;
  for (let i = 1; i <= s.length; i++)
    for (let j = 1; j <= t.length; j++) {
      const c = s[i - 1] === t[j - 1] ? 0 : cost;
      d[i][j] = Math.min(d[i - 1][j] + cost, d[i][j - 1] + cost, d[i - 1][j - 1] + c);
    }
  return d[s.length][t.length];
}
function paths(n: number, first: number): string {
  const d: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(first));
  for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) d[i][j] = d[i - 1][j] + d[i][j - 1];
  return d.map(row => row.join(" ")).join("|");
}
function closest(d: number[][], n: number): string {
  for (let k = 0; k < n; k++)
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const through = d[i][k] + d[k][j];
        if (through < d[i][j]) d[i][j] = through;
      }
  return d.map(row => row.join(" ")).join("|");
}
const said: string[] = [];
const show = (o: unknown): string =>
  Array.isArray(o)
    ? "[" + Array.from(o, (x, i) => (i in o ? show(x) : "_")).join() + "]#" + o.length
    : Object.is(o, -0)
      ? "-0"
      : String(o);
const tables: (() => number[][])[] = [
  () => [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]],
  () => [[0.5, 1.5, 2.5, 3.5], [4.5, 5.5, 6.5, 7.5], [8.5, 9.5, 10.5, 11.5], [12.5, 13.5, 14.5, 15.5]],
  () => [[0, 1, 2, 3], [0.5, 1.5, 2.5, 3.5], [4, 5, 6, 7], [4.5, 5.5, 6.5, 7.5]],
  () => [[2147483647, -2147483648, 2147483646, 0], [2147483647, 2147483647, 1, 2], [-2147483648, 3, -2147483648, 4], [5, 6, 7, 2147483647]],
  () => [[1, , 3, 4], [1, 2, , 4], [, 2, 3, 4], [1.5, 2, , 4]] as number[][],
  () => [[-0, 0, NaN, Infinity], [-Infinity, 1, 2, 3], [0, -0, 0, -0], [1e308, 1e308, 4, 5]],
  () => [new Array<number>(4).fill(0), new Array<number>(4).fill(1.5), new Array<number>(4).fill(0), [7, 8, 9, 10]],
  () => { const r = [1, 2, 3, 4]; return [r, r, r, r]; },
  () => [Object.freeze([1, 2, 3, 4]) as number[], [1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4]],
  () => [["1", "2", "3", "4"], ["5", 6, 7, 8], [null, undefined, 1, 2], [{ valueOf: () => 3 }, 1n, 2, 3]] as unknown as number[][],
  () => [[1, 2], [1, 2, 3], [], [1, 2, 3, 4, 5]],
  () => [[1, 2, 3, 4], undefined, [1, 2, 3, 4], [1, 2, 3, 4]] as number[][],
  () => [new Float64Array([1, 2, 3, 4]), [1, 2, 3, 4], new Int32Array([1, 2, 3, 4]), new Uint8Array([255, 0, 1, 2])] as unknown as number[][],
  () => { const m: number[][] = [[1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4]]; m[2] = m as unknown as number[]; return m; },
];
const tried = (name: string, f: () => unknown, o: unknown): void => {
  let answer: string;
  try { answer = show(f()); } catch (e) { answer = (e as Error).constructor.name; }
  said.push(name + " " + answer + " " + show(o));
};
for (let k = 0; k < tables.length; k++) {
  for (const n of [0, 1, 17, 64]) {
    for (const [name, f] of Object.entries({ count, lower, mask } as Record<string, (o: number[][], n: number) => number>)) { const o = tables[k](); tried(k + name + n, () => f(o, n), o.length > 3 && o[2] === (o as unknown) ? 0 : o); }
    for (const v of [1, -1, 0.5, 2147483647, NaN, -0]) for (const [name, f] of Object.entries({ add, scale } as Record<string, (o: number[][], n: number, v: number) => number>)) { const o = tables[k](); tried(k + name + n + " " + v, () => f(o, n, v), o.length > 3 && o[2] === (o as unknown) ? 0 : o); }
  }
}
for (const cost of [1, 0.5, 2, 1e9]) said.push(String(distance("kitten sitting", "sitting kittens", cost)), String(distance("", "abc", cost)), String(distance("flaw", "lawn", cost)));
said.push(paths(9, 1), paths(9, 0.5), paths(40, 1));
for (const far of [1e9, 99.5, Infinity, 2147483647]) said.push(closest([[0, 3, far, 7], [8, 0, 2, far], [5, far, 0, 1], [2, far, far, 0]], 4));
let digest = 0;
for (const line of said) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
console.log(said.length, digest);
for (let i = 0; i < said.length; i += 23) console.log(said[i].slice(0, 200));
