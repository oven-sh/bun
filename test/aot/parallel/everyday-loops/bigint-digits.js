// Digits of BigInt values by division, pushed and reversed
function digits(value, base) {
  const list = [];
  let negative = value < 0n;
  if (negative) value = -value;
  do {
    list.push(Number(value % base));
    value /= base;
  } while (value > 0n);
  for (let a = 0, b = list.length - 1; a < b; a++, b--) [list[a], list[b]] = [list[b], list[a]];
  return (negative ? "-" : "") + list.join(".");
}
console.log(digits(1234567890123456789n, 1000n));
console.log(digits(-255n, 16n), digits(0n, 2n));
console.log(digits(2n ** 70n, 7n), digits(99n, 100n));
