function filled(rows: number, columns: number): Float64Array {
  const table = new Float64Array(rows * columns);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      table[row * columns + column] = row + column / 10;
    }
  }
  return table;
}
function sumOfColumn(table: Float64Array, columns: number, column: number): number {
  let sum = 0;
  for (let at = column; at < table.length; at += columns) sum += table[at];
  return sum;
}
console.log(sumOfColumn(filled(3, 4), 4, 2).toFixed(1));
