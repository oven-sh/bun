// Elements that are whole numbers, read by constant and by computed positions, off arrays of integers, of doubles, of boxed values, and with holes.
class Runs { constructor(readonly runs: number[][]) {} compare(a: number, b: number): number { const x = this.runs[a]!, y = this.runs[b]!; return y[1]! - x[1]! || x[0]! - y[0]!; } sorted(): string { return this.runs.map((_, i) => i).sort((a, b) => this.compare(a, b)).join(); } }
function pushed(by: number): number[] { const list: number[] = []; for (let k = 1; k < 5; k++) list.push(k * by); return list; }
const boxed: number[] = [7, 8, 9, 10]; (boxed as unknown[])[4] = "end"; boxed.length = 4;
const holes: number[] = [1, 2, 3, 4]; delete holes[1];
const lists: number[][] = [[3, 1, 2, 4], [4294967296, 8589934592, 5, 6], pushed(3), pushed(4294967297), boxed, holes, Array.from(new Float64Array([1, 4294967295, 3, -0])), [...[1, 2], ...[4294967299, 4]], [5], []];
const at = (list: number[], i: number): number => list[i]!;
for (let round = 0; round < 3; round++) {
  for (const list of lists) console.log(list[0], list[1], list[0]! + list[1]!, (list[1]! | 0) ^ (list[2]! >>> 1), at(list, 3), at(list, 9), list[0]! % 7, list[0] === 3);
  console.log(new Runs(lists).sorted(), new Runs(lists.map(list => list.slice().reverse())).sorted());
}
// Counters in fields of a class of integers.
class Counter { at = 0; private readonly bytes = new Uint8Array([4, 5, 6, 7]); next(): number { return this.bytes[this.at++]!; } skip(n: number): void { this.at += n; } set(n: number): void { this.at = n; } }
for (const start of [0, 3, 2147483646, 2147483647, -1, -2147483648, 9007199254740991]) for (const n of [1, -1, 2147483647, 0.5, NaN]) { const c = new Counter(); c.set(start); c.skip(n); const first = c.next(); console.log(start, n, first, c.at, c.next(), c.at, JSON.stringify(c)); }
export {};
