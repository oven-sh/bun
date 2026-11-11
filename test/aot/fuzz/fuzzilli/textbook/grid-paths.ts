function paths(rows: number, columns: number): number {
  const counts: number[][] = [];
  for (let row = 0; row < rows; row++) {
    counts[row] = [];
    for (let column = 0; column < columns; column++) {
      counts[row][column] = row === 0 || column === 0 ? 1 : counts[row - 1][column] + counts[row][column - 1];
    }
  }
  return counts[rows - 1][columns - 1];
}
console.log(paths(Number("3"), Number("7")), paths(1, 1));
