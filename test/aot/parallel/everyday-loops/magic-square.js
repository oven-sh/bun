// A magic square filled by index, its sums pushed row by row
function magic(size) {
  const square = new Array(size * size).fill(0);
  let x = size >> 1, y = 0;
  for (let n = 1; n <= size * size; n++) {
    square[y * size + x] = n;
    const up = (y + size - 1) % size, right = (x + 1) % size;
    if (square[up * size + right] !== 0) y = (y + 1) % size;
    else [x, y] = [right, up];
  }
  const sums = [];
  for (let row = 0; row < size; row++) {
    for (let k = 0; k < size; k++) sums.push(square[row * size + k]);
    sums.push(sums.slice(-size).reduce((a, b) => a + b));
  }
  return sums.join();
}
console.log(magic(3));
console.log(magic(5));
console.log(magic(1));
