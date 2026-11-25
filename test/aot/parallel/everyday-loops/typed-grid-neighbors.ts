// Neighbors in a grid of declared numbers, collected in two lists
function neighbors(grid: number[][], border: number): [number[], number[]] {
  const sums: number[] = [];
  const peaks: number[] = [];
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const around = (grid[y - 1]?.[x] ?? border) + (grid[y + 1]?.[x] ?? border) + (grid[y][x - 1] ?? border) + (grid[y][x + 1] ?? border);
      sums.push(around);
      if (grid[y][x] * 4 > around) peaks.push(y * 3 + x);
    }
    sums.push(peaks.length);
  }
  return [sums, peaks];
}
console.log(JSON.stringify(neighbors([[1, 2, 3], [4, 9, 6], [7, 8, 9]], 0)));
console.log(JSON.stringify(neighbors([[5, 5, 5], [5, 5, 5], [5, 5, 5]], 5)));
console.log(JSON.stringify(neighbors([[0, 1, 0], [1, 0, 1], [0, 1, 0]], -1)));
