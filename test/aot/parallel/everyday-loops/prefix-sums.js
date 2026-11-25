// Prefix sums over a grid, read by rectangles
function rectangles(grid) {
  const sums = [[]];
  for (let x = 0; x <= (grid[0] || []).length; x++) sums[0].push(0);
  for (let y = 0; y < grid.length; y++) {
    sums.push([0]);
    for (let x = 0; x < grid[y].length; x++) sums[y + 1].push(grid[y][x] + sums[y][x + 1] + sums[y + 1][x] - sums[y][x]);
  }
  const out = [];
  for (let size = 1; size < sums.length; size++) {
    const row = sums[size];
    out.push(row[row.length - 1] - (sums[size - 1][1] || 0));
  }
  return out.join() + " " + sums.map(row => row.join("+")).join("/");
}
console.log(rectangles([[1, 2], [3, 4], [5, 6]]));
console.log(rectangles([[0.5, -0.5, 1e9], [2147483647, 1, 1]]));
console.log(rectangles([]), rectangles([[7]]));
