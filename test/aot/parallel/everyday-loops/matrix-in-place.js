// A square matrix transposed and turned in place by swaps of destructured pairs
function turn(matrix) {
  const n = matrix.length;
  for (let y = 0; y < n; y++) {
    for (let x = y + 1; x < n; x++) [matrix[y][x], matrix[x][y]] = [matrix[x][y], matrix[y][x]];
  }
  for (const row of matrix) {
    for (let a = 0, b = n - 1; a < b; a++, b--) {
      const kept = row[a];
      row[a] = row[b];
      row[b] = kept;
    }
  }
  return matrix.map(row => row.join()).join("/");
}
const square = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
console.log(turn(square), turn(square));
console.log(turn([["a", 1.5], [null, undefined]]));
console.log(turn([]), turn([[0]]), turn([[-0, NaN, 1, 2], [3, 4, 5, 6], [7, 8, 9, "x"], [{}, [], "y", "z"]]));
