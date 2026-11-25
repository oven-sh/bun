// `width` comes from in front of the loops, nobody knows what it is, and the loops make keys of it. It is expected to be an int32; here it often is none.
function flat(width: any, cells: Float64Array, at: number): number {
  let sum = 0;
  for (let row = 0; row < 4; row++) sum += cells[(row * width + at) | 0] ?? -1000;
  return sum;
}
function bare(width: any, cells: number[], at: number): number {
  let sum = 0;
  for (let row = 0; row < 4; row++) sum += cells[row * width + at] ?? -1000;
  return sum;
}
function last(width: any, cells: number[]): number {
  let sum = 0;
  for (let turn = 0; turn < 3; turn++) sum += cells[width - 1 - turn] ?? -1000;
  return sum;
}
function stored(width: any, size: number): string {
  const cells = new Array<number>(size).fill(0);
  for (let row = 0; row < 3; row++) cells[(row * width) >>> 0 < size ? (row * width) >>> 0 : 0] += row + 1;
  return cells.join();
}
function both(width: any, cells: Float64Array): number {
  let sum = 0;
  for (let row = 0; row < 4; row++) sum += cells[(row * width) | 0]! * width;
  return sum;
}
function tried(run: () => unknown): string {
  try { return String(run()); } catch (error) { return (error as Error).constructor.name; }
}
const cells = Float64Array.from({ length: 16 }, (_, i) => i + 0.5);
const list = Array.from(cells);
let asked = 0;
const widths: unknown[] = [
  4, 3, 1, 0, -1, -0, 2.5, 0.25, 2 ** 31, 2 ** 31 - 1, -(2 ** 31), 2 ** 32 + 3, 2 ** 53, 1e300, NaN, Infinity, -Infinity,
  "3", "2.5", "x", "", null, undefined, true, false, [], [2], {}, { valueOf() { asked++; return 2; } }, { valueOf() { throw new RangeError("no"); } }, 3n, Symbol.iterator,
];
for (let turn = 0; turn < 2; turn++) {
  for (const width of widths) {
    console.log(typeof width, tried(() => flat(width, cells, 1)), tried(() => bare(width, list, 1)), tried(() => last(width, list)), tried(() => stored(width, 8)), tried(() => both(width, cells)), asked);
  }
}
for (let turn = 0; turn < 3; turn++) console.log(flat(4, cells, turn), bare(4, list, turn), last(16 - turn, list), stored(turn + 1, 8), both(turn + 1, cells));
export {};
