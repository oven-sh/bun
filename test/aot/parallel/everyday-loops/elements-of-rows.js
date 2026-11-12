// Elements of a matrix flattened with a sum behind each row
function flatten(matrix) {
  const out = [];
  for (let y = 0; y < 3; y++) {
    let sum = 0;
    for (let x = 0; x < 3; x++) {
      out.push(matrix[y][x]);
      sum += matrix[y][x];
    }
    out.push(sum);
  }
  return out.join(" ") + " = " + out.length;
}
console.log(flatten([[1, 2, 3], [4, 5, 6], [7, 8, 9]]));
console.log(flatten([[5, 10, 15], [20, 25, 30], [0, -1, 1]]));
console.log(flatten([[1, 0, 0], [0, 1, 0], [0, 0, 1]]));
