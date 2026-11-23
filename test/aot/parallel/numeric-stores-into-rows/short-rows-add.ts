// Under: --aot-testing=CheckBoundsAtRunTime: every access to an element is checked against its array
const base: number[] = []; for (let i = 0; i < 36; i++) base.push((i * 37) % 101);
const values: any[] = [1, 0.5, "s", -0, NaN, undefined, {}, 2147483648, true, null, 7];
const make = (): any => [[1, 2, 3, 4, 5, 6], [1, 2], [], [1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3], [1, 2, 3, 4, 5, 6]];
function touch(grid: number[][], x: number, y: number): number { if (x === 3) grid[y] = [x, y]; return x - y; }
function run(grid: number[][], from: number, rows: number, columns: number): number {
  let total = 0;
  for (let y = from; y < rows; y++) {
    for (let x = from; x < columns; x++) {
      grid[y]![x]! += 3;
    }
  }
  return total;
}
function show(x: any, depth: number): string {
  if (Array.isArray(x)) { if (depth > 2) return "[..]"; let s = "["; for (let i = 0; i < Math.min(x.length, 12); i++) s += (i in x ? show(x[i], depth + 1) : "hole") + ","; return s + "]" + x.length; }
  return Object.is(x, -0) ? "-0" : typeof x === "object" && x ? "o" + Object.keys(x).slice(0, 8).map(k => k + show(x[k], depth + 1)).join() : String(x);
}
for (const [from, rows, columns] of [[1, 5, 5], [0, 6, 6], [1, 5, 9], [0, 8, 3], [2, 4, 4]]) {
  const grid = make();
  for (let round = 0; round < 3; round++) {
    let line: string;
    try { line = String(run(grid, from!, rows!, columns!)); } catch (e: any) { line = e.constructor.name; }
    console.log(from, rows, columns, line, show(grid, 0));
  }
}
