// A matrix filled by index, transposed into another and multiplied
function make(height, width, start) {
  const matrix = new Array(height);
  for (let y = 0; y < height; y++) {
    matrix[y] = [];
    for (let x = 0; x < width; x++) matrix[y][x] = start++;
  }
  return matrix;
}
function transpose(matrix) {
  const out = [];
  for (let y = 0; y < matrix.length; y++) for (let x = 0; x < matrix[y].length; x++) (out[x] = out[x] || [])[y] = matrix[y][x];
  return out;
}
function multiply(a, b) {
  return a.map(row => b[0].map((_, x) => row.reduce((sum, value, i) => sum + value * b[i][x], 0)));
}
for (const [height, width, start] of [[2, 3, 1], [3, 1, 0.5], [1, 4, -2]]) {
  const matrix = make(height, width, start);
  console.log(JSON.stringify(transpose(matrix)), JSON.stringify(multiply(matrix, transpose(matrix))));
}
