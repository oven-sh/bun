// Sums and products of BigInt values in two loops, kept in a list
function powers(base, rows) {
  const out = [];
  let sum = 0n;
  for (let y = 0; y < rows; y++) {
    let value = 1n;
    for (let x = 0; x <= y; x++) {
      value *= base + BigInt(x);
      sum += value;
      if (value > 10n ** 18n) value = BigInt.asIntN(64, value);
    }
    out.push(value, sum % 1000n);
  }
  return out.join() + " " + sum;
}
console.log(powers(3n, 4));
console.log(powers(-7n, 6));
console.log(powers(12345678901n, 3), powers(0n, 2));
