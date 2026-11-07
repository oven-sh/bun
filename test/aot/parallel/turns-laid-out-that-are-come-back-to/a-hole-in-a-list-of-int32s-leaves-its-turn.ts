// STATISTIC: LoopsLaidOutThatAreComeBackTo >= 2
function count(list: number[], k: number): number { let n = 0; for (const v of list) if (k + v > 4) n++; return n; }
function most(list: number[], k: number): number { let m = 0; for (let i = 0; i < list.length; i++) { const w = k * list[i]!; if (w > m) m = w; } return m; }
const places: ((size: number) => number[])[] = [() => [], () => [0], () => [5], () => [7], () => [8], size => [size - 1], () => [3, 4, 5], () => [10, 30, 50, 70, 90], size => Array.from({ length: size >> 1 }, (_, i) => 2 * i), size => Array.from({ length: size }, (_, i) => i)];
for (const size of [0, 1, 7, 8, 9, 17, 64, 65, 100, 700, 1400]) for (let p = 0; p < places.length; p++) {
  const list: number[] = new Array(size); list.fill(0); for (let i = 0; i < size; i++) list[i] = i & 7;
  for (const hole of places[p]!(size)) if (hole >= 0 && hole < size) delete list[hole];
  console.log(size, p, count(list, 1), most(list, 3));
}
