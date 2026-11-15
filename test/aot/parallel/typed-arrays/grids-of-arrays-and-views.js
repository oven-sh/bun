// Rows that are arrays in one grid and views in another: the length of a row is read off whichever it is.
const show = grid => console.log(grid.map(row => Array.prototype.join.call(row, ",")).join(" | "));
class Grid { constructor(g) { this.g = g; } go(w) { const g = this.g; for (let y = 0; y < g.length; y++) { const row = g[y]; for (let x = 0; x < row.length && x < 9; x++) { g[y][w - 1 - x] = (g[y][0] + g[y][(x + 1) % w]) / 2; } g[0][1] = 'z'; } } }
for (const [grid, width] of [[[[1, 2, 3], [4, 5, 6]], 4], [[new Float64Array(4), new Float64Array(4)], 4], [[[1, , 3], [, 2, 3]], 0], [[new Uint8Array([1, 2, 3]), [7, 8]], 3]]) {
  new Grid(grid).go(width);
  show(grid);
}
