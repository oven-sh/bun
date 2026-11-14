// A product of two matrices of three by three, pushed cell by cell
function product(a, b) {
  const out = [];
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[y * 3 + k] * b[k * 3 + x];
      out.push(sum);
    }
    out.push(a[y * 4] - b[y * 4]);
  }
  return out;
}
const one = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const many = [1, 2, 3, 4, 5, 6, 7, 8, 9];
console.log(product(many, one).join());
console.log(product(many, many).join());
console.log(product(one, one).join(), product(product(many, many), many).length);
