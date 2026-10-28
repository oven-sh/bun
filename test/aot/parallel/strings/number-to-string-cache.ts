// The engine remembers the text of the numbers it has turned into strings. Numbers that are short in binary (1.5, 2.25, 100.5) and
// numbers that repeat in binary (0.1, 19.99) must not all share a few places of that memory, or each conversion forgets the last:
// four such numbers converted in turn cost four whole conversions a round.
const values: number[] = [];
for (let k = 1; k <= 400; k++) values.push(k + 0.5, k / 4, k / 10, k / 100, k * 1e9 + 0.5, 2 ** 31 + k, 1 / k, -k - 0.25);
values.push(0.1 + 0.2, 1e21, 1e-7, 5e-324, 1.7976931348623157e308, -0, NaN, Infinity, -Infinity, 123456789.125, 4294967295.5);
let length = 0;
let sum = 0;
for (let round = 0; round < 3; round++) {
  for (const value of values) {
    const text = "" + value;
    length += text.length;
    if (Number(text) !== value && value === value) console.log("does not read back:", text);
    sum += `${value}`.length + String(value).length + value.toString().length;
  }
}
console.log(length, sum, "" + 1.5, "" + 2.5, "" + 1.5, `${0.1}|${0.2}|${0.1}`, String(100.5), (2.25).toString(), "" + -0, "" + 1e21);
