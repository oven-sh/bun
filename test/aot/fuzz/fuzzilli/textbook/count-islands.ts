function islands(grid: number[][]): number {
  let count = 0;
  function sink(row: number, column: number): void {
    if (row < 0 || column < 0 || row >= grid.length || column >= grid[row].length || grid[row][column] === 0) return;
    grid[row][column] = 0;
    sink(row + 1, column);
    sink(row - 1, column);
    sink(row, column + 1);
    sink(row, column - 1);
  }
  for (let row = 0; row < grid.length; row++) {
    for (let column = 0; column < grid[row].length; column++) {
      if (grid[row][column] === 1) {
        count++;
        sink(row, column);
      }
    }
  }
  return count;
}
console.log(islands(JSON.parse("[[1,1,0,0],[0,0,1,0],[1,0,1,1]]")));
