// `grid.cells[0]`: the field is declared Int32Array. A cold function of a very large program gets the test of `grid` behind the rounds of its passes.
// What the read of the field gives has the type of its slot, so the access to the element needs no test and looks nothing up.
// Flags: --aot-limit=MaxWarmCodeValues:1
// COUNT: arrivals <= 30
interface Grid {
  width: number;
  cells: Int32Array;
}
function make(width: number, height: number): Grid {
  return { width, cells: new Int32Array(width * height) };
}
function firstAndWidth(grid: Grid): number {
  return grid.cells[0]! + grid.width;
}
function mark(grid: Grid): number {
  grid.cells[1] = 7;
  grid.cells[2] = 9;
  return grid.width;
}
function pairAt(grid: Grid, index: number): number {
  const at = index << 1;
  return grid.cells[at]! * grid.width;
}
const grid = make(4, 4);
for (let i = 0; i < 16; i++) grid.cells[i] = i * 3;
function turn(i: number): number {
  if (i < -1) return turn(i + 1);
  return mark(grid) + pairAt(grid, i & 7);
}
(globalThis as any)[process.env.NO_SUCH_NAME ?? "handedOverByThisProgram"] = { make, firstAndWidth, mark, pairAt };
let sum = 0;
for (let i = 0; i < 1000; i++) sum = (sum + turn(i)) | 0;
console.log(sum, pairAt(grid, 99), firstAndWidth({ width: 1, cells: new Int32Array(0) }));
try {
  firstAndWidth({ width: 1, cells: null as unknown as Int32Array });
} catch (error) {
  console.log((error as Error).constructor.name);
}
try {
  mark({ width: 1, cells: undefined as unknown as Int32Array });
} catch (error) {
  console.log((error as Error).constructor.name);
}
console.log(firstAndWidth({ width: 2, cells: [5] as unknown as Int32Array }), mark({ width: 3, cells: {} as unknown as Int32Array }));
