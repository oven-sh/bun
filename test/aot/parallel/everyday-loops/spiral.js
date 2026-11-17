// A grid filled in a spiral by four loops and read in rows
function spiral(height, width) {
  const grid = Array.from({ length: height }, () => []);
  let top = 0, left = 0, bottom = height - 1, right = width - 1, n = 0;
  while (top <= bottom && left <= right) {
    for (let x = left; x <= right; x++) grid[top][x] = n++;
    for (let y = ++top; y <= bottom; y++) grid[y][right] = n++;
    right--;
    if (top <= bottom) for (let x = right; x >= left; x--) grid[bottom][x] = n++;
    bottom--;
    if (left <= right) for (let y = bottom; y >= top; y--) grid[y][left] = n++;
    left++;
  }
  return grid.map(row => row.join(" ")).join(" / ") + " " + n;
}
console.log(spiral(3, 4));
console.log(spiral(4, 1), spiral(1, 5));
console.log(spiral(0, 3), spiral(5, 5));
