// STATISTIC: InvariantNumberGuardsHoisted >= 3
// A grid in one view, as renderers and parsers keep them: every access goes by `row * width + column` or `offset + index`, and the numbers come out of fields and divisions, so that nothing in the text says that they are whole.
// What the build makes of the loops may not show: among the whole numbers that they are written for come a fraction, -0, NaN, an infinity and numbers beyond 32 bits.
class Grid {
    cells: Int32Array;
    width: number;
    height: number;
    constructor(width: number, height: number) { this.width = width; this.height = height; this.cells = new Int32Array(width * height); }
}
function copyRow(from: Int32Array, to: Int32Array, row: number, width: number): number {
    const base = row * width;
    for (let column = 0; column < width; column++) to[base + column] = from[base + column];
    return base;
}
function sumOfRow(grid: Grid, row: number): number {
    const base = row * grid.width;
    let sum = 0;
    for (let column = 0; column < grid.width; column++) sum += grid.cells[base + column]!;
    return sum;
}
function mirrorRow(grid: Grid, row: number): void {
    const last = row * grid.width + grid.width - 1, first = row * grid.width;
    for (let column = 0; column < grid.width / 2; column++) {
        const kept = grid.cells[first + column]!;
        grid.cells[first + column] = grid.cells[last - column]!;
        grid.cells[last - column] = kept;
    }
}
const grid = new Grid(16, 12), other = new Grid(16, 12);
for (let at = 0; at < grid.cells.length; at++) grid.cells[at] = (at * 7) % 101;
const rows = [0, 1, 5.5 * 2, 22 / 2, 3 / 2, -0, -1, 12, NaN, Infinity, 2 ** 28, 2 ** 31, -(2 ** 31), 2 ** 49];
const said: string[] = [];
for (let round = 0; round < 40; round++) {
    for (const row of rows) {
        said.push(String(Object.is(copyRow(grid.cells, other.cells, row, grid.width), -0)), String(sumOfRow(grid, row)));
        mirrorRow(other, row);
    }
}
let check = 0;
for (const cell of other.cells) check = (check * 31 + cell) | 0;
console.log(said.slice(0, rows.length * 2).join(" "), said.length, check, Object.keys(other.cells).length);
