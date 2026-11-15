const inputs: any[] = JSON.parse("[0, -0.1, 4.5, 1e300, -2147483648, 0.30000000000000004, 1e-320, 123456789.125, null, 86399999]");
inputs.push(NaN, Infinity, -Infinity, -0, 2 ** 53, -(2 ** 53));
function dayOf(time: number) {
  const days = (time + 43200000.5) / 86400000;
  return days * 0.0027379070069885 - 1969.75;
}
function polynomial(x: number) {
  return (((x * 0.0001953125 - 0.0083333333) * x + 0.1666666667) * x - 1.5707963267948966) / 3.141592653589793;
}
function sides(x: number) {
  return [1.5 - x, x - 1.5, 1.5 / x, x / 1.5, x + 1.5, 1.5 + x, x * -1.7, -1.7 * x].join();
}
function inLoop(values: any[], turns: number) {
  let sum = 0.1, product = 1.0000001;
  for (let i = 0; i < turns; i++) {
    const value = values[i % values.length];
    if (typeof value === "number" && value === value && value < 1e18 && value > -1e18) sum = sum * 0.9999 + value / 365.2425 - 0.3;
    product = product * 1.0000003 + 0.25 / (i + 1.75);
  }
  return sum + ":" + product;
}
function compareWords(words: BigInt64Array) {
  let line = "";
  for (const word of words) line += (word < 0x123456789abcdefn ? 1 : 0) + (word > -0x7edcba987654321n ? 2 : 0) + (word === 0x123456789abcdefn ? 4 : 0);
  return line;
}
for (const input of inputs) console.log(String(input), dayOf(input), polynomial(input), sides(input));
console.log(inLoop(inputs, 400), inLoop([1, 2.5], 7), compareWords(new BigInt64Array([0n, 0x123456789abcdefn, -0x7edcba987654321n, -1n, 0x7fffffffffffffffn])));
