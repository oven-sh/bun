const launder = new Function("value", "return value") as <V>(value: V) => V;

const numbers: number[] = [
  0, -0, 1, -1, 0.5, -0.5, 1.5, 2 ** 31, -(2 ** 31), 2 ** 31 - 1, 2 ** 32, 2 ** 52, 2 ** 53 - 1, 2 ** 53, 2 ** 53 + 2, -(2 ** 53 - 1), -(2 ** 53), 2 ** 63, -(2 ** 63), 2 ** 64, 1e21, 1e300, -1e300,
  Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE, Number.EPSILON, 4503599627370495.5, 4503599627370496.5, 0.1 + 0.2, NaN, -NaN, Infinity, -Infinity, 1 / 3, 123456789.000001,
];
const others: unknown[] = [undefined, null, true, false, "", "1", "NaN", "Infinity", 1n, [], [1], {}, new Number(1), new Number(NaN), Symbol.iterator, () => 1, { valueOf: () => 1 }];

class Measured {
  size: number;
  count: number;
  maybe: number | undefined;
  anything: unknown;
  constructor(size: number, count: number, maybe: number | undefined, anything: unknown) {
    this.size = size;
    this.count = count;
    this.maybe = maybe;
    this.anything = anything;
  }
}

function flags(...answers: boolean[]): string {
  let said = "";
  for (const answer of answers) said += answer ? "y" : "n";
  return said;
}

function ofNumber(x: number): string {
  return flags(Number.isNaN(x), Number.isFinite(x), Number.isInteger(x), Number.isSafeInteger(x), isNaN(x), isFinite(x));
}

function ofFields(one: Measured): string {
  let said = flags(Number.isNaN(one.size), Number.isFinite(one.size), Number.isInteger(one.size), Number.isSafeInteger(one.size));
  said += flags(Number.isNaN(one.count), Number.isFinite(one.count), Number.isInteger(one.count), Number.isSafeInteger(one.count));
  said += flags(Number.isNaN(one.maybe), Number.isFinite(one.maybe), Number.isInteger(one.maybe), Number.isSafeInteger(one.maybe));
  said += flags(Number.isNaN(one.anything), Number.isFinite(one.anything), Number.isInteger(one.anything), Number.isSafeInteger(one.anything));
  if (Number.isInteger(one.size)) said += "I";
  if (!Number.isFinite(one.size)) said += "F";
  if (Number.isNaN(one.size) || Number.isNaN(one.maybe)) said += "N";
  return said;
}

function ofElements(list: number[]): string {
  let whole = 0, finite = 0, safe = 0, none = 0;
  for (let i = 0; i < list.length; i++) {
    if (Number.isInteger(list[i])) whole++;
    if (Number.isFinite(list[i])) finite++;
    if (Number.isSafeInteger(list[i])) safe++;
    if (Number.isNaN(list[i])) none++;
  }
  return [whole, finite, safe, none].join(",");
}

function ofResults(x: number, y: number): string {
  return flags(Number.isNaN(x - y), Number.isFinite(x * y), Number.isInteger(x / y), Number.isSafeInteger(x + y), Number.isInteger(x | 0), Number.isNaN(x | 0), Number.isFinite((x | 0) + (y | 0)), Number.isSafeInteger((x | 0) * (y | 0)), Number.isInteger(x % y), Number.isNaN((x | 0) % (y | 0)));
}

const lines: string[] = [];
for (let round = 0; round < 3; round++) {
  lines.length = 0;
  for (let i = 0; i < numbers.length; i++) {
    const x = launder(numbers[i]);
    const y = launder(numbers[(i * 7 + 3) % numbers.length]);
    const one = launder(new Measured(x, i, i % 3 === 0 ? undefined : x, i % 2 === 0 ? x : String(x)));
    lines.push(i + " " + ofNumber(x) + " " + ofFields(one) + " " + ofResults(x, y));
  }
  for (let i = 0; i < others.length; i++) {
    const one = launder(new Measured(i + 0.5, i, undefined, launder(others[i])));
    lines.push("other " + i + " " + ofFields(one));
  }
  lines.push(ofElements(launder(numbers)), ofElements(launder([1, 2, 3])), ofElements(launder([1.5, NaN, Infinity])), ofElements(launder([])));
}
console.log(lines.join("\n"));
