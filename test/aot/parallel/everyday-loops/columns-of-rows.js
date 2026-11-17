// Columns of a matrix gathered into rows, each row pushed when it is whole
function columns(matrix) {
  const out = [];
  for (let x = 0; x < 3; x++) {
    const column = [];
    for (let y = 0; y < 2; y++) column.push(matrix[y][x]);
    column.push(column[0] + column[1]);
    out.push(column);
  }
  for (let i = 0; i < 3; i++) out[i][out[i].length] = i;
  return JSON.stringify(out);
}
console.log(columns([[1, 2, 3], [4, 5, 6]]));
console.log(columns([[0.5, "b", null], [1, "c", 2]]));
console.log(columns([[7, 8, 9], [-7, -8, -9]]), columns([[1], [2]]));
