// A polynomial evaluated at points and differentiated between them
function table(coefficients) {
  const out = [];
  for (let d = 0; d < 3; d++) {
    for (let x = -1; x < 3; x++) {
      let value = 0;
      for (let k = 3; k >= 0; k--) value = value * x + coefficients[k];
      out.push(value);
    }
    for (let k = 0; k < 3; k++) coefficients[k] = coefficients[k + 1] * (k + 1);
    coefficients[3] = 0;
    out.push(coefficients[0]);
  }
  return out.join();
}
console.log(table([1, 2, 3, 4]));
console.log(table([0, 0, 0, 1]));
console.log(table([5, -5, 10, -10]));
