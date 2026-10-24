// Closures that are lent, one probe of many. It prints what plain Bun prints.
function viaMap(xs: number[], k: number): number[] { return xs.map(v => v * k); }
function viaForEach(xs: number[], k: number): number { let s = 0; xs.forEach(v => { s += v * k; }); return s; }
function viaFilter(xs: number[], k: number): number[] { return xs.filter(v => v > k); }
function viaReduce(xs: number[], k: number): number { return xs.reduce((a, v) => a + v * k, 0); }
function viaSort(xs: number[], k: number): number[] { return xs.slice().sort((a, b) => (a - b) * k); }
function viaSome(xs: number[], k: number): boolean { return xs.some(v => v === k); }
function viaEvery(xs: number[], k: number): boolean { return xs.every(v => v !== k); }
function viaFind(xs: number[], k: number): number | undefined { return xs.find(v => v === k); }
function viaFindIndex(xs: number[], k: number): number { return xs.findIndex(v => v === k); }
function viaMapForEach(m: Map<number, number>, k: number): number { let s = 0; m.forEach((v, key) => { s += v * k + key; }); return s; }
function viaSetForEach(m: Set<number>, k: number): number { let s = 0; m.forEach(v => { s += v * k; }); return s; }
function viaReplace(t: string, k: number): string { return t.replace(/a/g, m => m + k); }
function viaPromise(k: number): Promise<number> { return new Promise<number>(resolve => resolve(k)); }
function viaFlatMap(xs: number[], k: number): number[] { return xs.flatMap(v => [v, k]); }
function viaArrayFrom(xs: number[], k: number): number[] { return Array.from(xs, v => v + k); }

const xs = [1, 2, 3, 4, 5, 6, 7, 8];
const m = new Map<number, number>([[1, 2], [3, 4]]);
const st = new Set<number>([1, 2, 3]);
let total = 0;
for (let i = 0; i < 1000; i++) {
  total += viaMap(xs, i).length + viaForEach(xs, i) + viaFilter(xs, i & 7).length + viaReduce(xs, i) + viaSort(xs, 1 + (i & 1))[0];
  total += (viaSome(xs, i & 15) ? 1 : 0) + (viaEvery(xs, i & 15) ? 1 : 0) + (viaFind(xs, i & 15) ?? 0) + viaFindIndex(xs, i & 15);
  total += viaMapForEach(m, i) + viaSetForEach(st, i) + viaReplace("banana", i).length + viaFlatMap(xs, i).length + viaArrayFrom(xs, i).length;
  viaPromise(i);
}
console.log(total);
