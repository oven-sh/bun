// Nested loops over an array parameter: the indexing type check is hoisted out of the inner loop, and a guard repeated within one iteration is emitted once. An iteration that fails a guard takes the slow path and returns to the fast loop.
declare const console: { log(...v: unknown[]): void };
function reach(list: number[], width: number): number { let t = 0; for (let first = 0; first + width <= list.length; first += width) { let least = list[first]!, most = list[first]!; for (let at = first + 1; at < first + width; at++) { least = Math.min(least, list[at]!); most = Math.max(most, list[at]!); } t += most - least; } return t; }
function reachPastTheEnd(list: number[], width: number): string { let out = ""; for (let first = 0; first < list.length; first += width) { let least = Infinity, most = -Infinity; for (let at = first; at < first + width; at++) { least = Math.min(least, list[at]!); most = Math.max(most, list[at]!); } out += least + ".." + most + " "; } return out; }
function rows(grid: number[], columns: number, scale: number[]): number { let t = 0; const count = grid.length / columns; for (let row = 0; row < count; row++) { let sum = 0; for (let column = 0; column < columns; column++) sum += grid[row * columns + column]! * scale[column]!; t += sum * (row + 1); } return t; }
function changesBetweenRows(grid: number[], columns: number, at: number, act: () => void): string { let out = ""; for (let row = 0; row * columns < grid.length; row++) { if (row === at) act(); let sum = 0; for (let column = 0; column < columns; column++) sum += grid[row * columns + column] ?? -1; out += sum + " "; } return out; }
function changesInsideARow(grid: number[], columns: number, at: number, act: () => void): string { let out = ""; for (let row = 0; row * columns < grid.length; row++) { let sum = 0; for (let column = 0; column < columns; column++) { if (row * columns + column === at) act(); sum += grid[row * columns + column] ?? -1; } out += sum + " "; } return out; }
function said(run: () => unknown): string { try { return String(run()); } catch (e) { return (e as Error).constructor.name; } }

const halves: number[] = []; for (let i = 0; i < 48; i++) halves.push(((i * 29) % 17) * 0.5);
const wholes: number[] = []; for (let i = 0; i < 48; i++) wholes.push((i * 31) % 23);
const withNaN = halves.slice(); withNaN[13] = NaN; withNaN[40] = NaN;
const withHole = halves.slice(); delete withHole[21];
const nothing = null as unknown as number[];
const out: unknown[] = [];
for (let r = 0; r < 3; r++) {
  out.push(reach(halves, 8), reach(wholes, 8), reach(halves, 5), reach(halves, 48), reach(halves, 49), reach([], 4), reach(halves, 1));
  out.push(reach(withNaN, 8), reach(withHole, 8), reach(withNaN, 48), reachPastTheEnd(halves, 7), reachPastTheEnd(wholes, 48), reachPastTheEnd(withNaN, 16), reachPastTheEnd(withHole, 12), reachPastTheEnd([], 3));
  out.push(rows(halves, 6, wholes), rows(wholes, 6, halves), rows(halves, 6, [1, 2, 3]), rows(wholes, 48, wholes), rows([], 6, nothing), said(() => rows(halves, 6, nothing)), said(() => reach(nothing, 4)));
}
{ const grid = halves.slice(); out.push(changesBetweenRows(grid, 8, 2, () => { grid.length = 20; })); }
{ const grid = wholes.slice(); out.push(changesBetweenRows(grid, 8, 3, () => { grid[30] = 0.25; })); }
{ const grid = halves.slice(); out.push(changesBetweenRows(grid, 8, 1, () => { delete grid[10]; grid.push(1, 2, 3); })); }
{ const grid = halves.slice(); out.push(changesInsideARow(grid, 8, 19, () => { grid.length = 21; })); }
{ const grid = wholes.slice(); out.push(changesInsideARow(grid, 8, 11, () => { grid[12] = 7.75; grid[60] = 1; })); }
{ const grid = wholes.slice(); out.push(changesInsideARow(grid, 8, 5, () => { grid.length = 0; })); }
console.log(out.join(" "));
