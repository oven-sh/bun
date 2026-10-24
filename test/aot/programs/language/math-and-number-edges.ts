// Math.*, Number.is*, isNaN, isFinite, Number(x), parseInt and Number.prototype.toString at the edges of the number type: -0, NaN, the infinities, 2 ** 53, nullish and boolean operands, quotients of integers, powers of 2 and 10, spread arrays, radixes, 16-bit strings and ropes.
const show = (value: unknown): string => (Object.is(value, -0) ? "-0" : String(value));
const rounded = (value: number): string => (Object.is(value, -0) ? "-0" : String(Number(value.toPrecision(10))));
const say = (run: () => unknown): string => {
  try {
    return show(run());
  } catch (error) {
    return (error as Error).name;
  }
};

function exactOfNumber(x: number): unknown[] {
  return [
    Math.abs(x), Math.floor(x), Math.ceil(x), Math.trunc(x), Math.round(x), Math.fround(x), Math.f16round(x), Math.sqrt(x), Math.sign(x), Math.clz32(x),
    Math.imul(x, 3), Math.imul(5, x), Math.min(x), Math.max(x), Math.min(x, 1), Math.max(x, 1), Math.min(0, x), Math.max(-0, x), Math.min(x, 2, -3.5), Math.max(x, 2, -3.5),
    Math.hypot(x), Math.pow(x, 0), Math.pow(x, 1), Math.pow(x, 2), Math.pow(x, 3), Math.pow(x, 0.5), Math.pow(x, -0.5), x ** 2, x ** 0.5,
    isNaN(x), isFinite(x), Number.isNaN(x), Number.isFinite(x), Number.isInteger(x), Number.isSafeInteger(x), Number(x), parseInt(x as any), parseInt(x as any, 36),
  ];
}

function libraryOfNumber(x: number): number[] {
  return [
    Math.sin(x), Math.sinh(x), Math.cos(x), Math.cosh(x), Math.tan(x), Math.tanh(x), Math.asin(x), Math.asinh(x), Math.acos(x), Math.acosh(x), Math.atan(x), Math.atanh(x),
    Math.log(x), Math.log10(x), Math.log2(x), Math.cbrt(x), Math.exp(x), Math.expm1(x), Math.log1p(x), Math.atan2(x, 1), Math.atan2(1, x), Math.atan2(x, x), Math.atan2(x, -0),
    Math.hypot(x, 3), Math.hypot(3, x, 4), Math.hypot(x, 3, 4, 12), Math.pow(x, 1.5), Math.pow(x, -1), Math.pow(2, x), Math.pow(10, x), 2 ** x, 10 ** x,
  ];
}

function ofNumberOrBoolean(x: number | boolean): unknown[] {
  const y = x as any;
  return [
    Math.abs(y), Math.floor(y), Math.ceil(y), Math.trunc(y), Math.round(y), Math.fround(y), Math.f16round(y), Math.sqrt(y), Math.sign(y), Math.clz32(y),
    Math.imul(y, 3), Math.imul(5, y), Math.min(y), Math.max(y), Math.min(y, 0.5), Math.max(y, 0.5), Math.hypot(y), Math.hypot(y, 0), Math.hypot(y, 0, 0),
    Math.pow(y, 0), Math.pow(y, 1), Math.pow(y, 2), Math.pow(y, 0.5), rounded(Math.pow(2, y)), rounded(Math.pow(10, y)), Math.expm1(y) > 1, Math.atan2(y, 0) > 1,
    isNaN(y), isFinite(y), Number.isNaN(y), Number.isFinite(y), Number.isInteger(y), Number.isSafeInteger(y), Number(y), parseInt(y), parseInt(y, 36),
  ];
}

function ofComparison(a: number, b: number): unknown[] {
  const y = (a < b) as any;
  return [
    Math.abs(y), Math.floor(y), Math.ceil(y), Math.trunc(y), Math.round(y), Math.fround(y), Math.f16round(y), Math.sqrt(y), Math.sign(y), Math.clz32(y),
    Math.imul(y, 3), Math.imul(5, y), Math.min(y), Math.max(y), Math.min(y, 0.5), Math.max(y, 0.5), Math.hypot(y), Math.hypot(y, 0), Math.hypot(y, 0, 0),
    Math.pow(y, 0), Math.pow(y, 1), Math.pow(y, 2), Math.pow(y, 0.5), rounded(Math.pow(2, y)), rounded(Math.pow(10, y)), Math.expm1(y) > 1, Math.atan2(y, 0) > 1,
    isNaN(y), isFinite(y), Number.isNaN(y), Number.isFinite(y), Number.isInteger(y), Number.isSafeInteger(y), Number(y), parseInt(y), parseInt(y, 36),
  ];
}

function ofAnything(y: any): unknown[] {
  return [
    Math.abs(y), Math.floor(y), Math.ceil(y), Math.trunc(y), Math.round(y), Math.fround(y), Math.f16round(y), Math.sqrt(y), Math.sign(y), Math.clz32(y),
    Math.imul(y, 3), Math.imul(5, y), Math.min(y), Math.max(y), Math.min(y, 0.5), Math.max(y, 0.5), Math.hypot(y), Math.hypot(y, 0), Math.hypot(y, 0, 0),
    Math.pow(y, 0), Math.pow(y, 1), Math.pow(y, 2), Math.pow(y, 0.5), rounded(Math.pow(2, y)), rounded(Math.pow(10, y)), Math.expm1(y) > 1, Math.atan2(y, 0) > 1,
    isNaN(y), isFinite(y), Number.isNaN(y), Number.isFinite(y), Number.isInteger(y), Number.isSafeInteger(y), Number(y), parseInt(y), parseInt(y, 36),
  ];
}

function ofIntegers(): string {
  let text = "";
  for (let i = -3; i <= 3; i++) {
    const wide = i * 3000000000;
    const limit = 9007199254740991 + (i & 1);
    text += [
      Math.abs(i), Math.sign(i), Math.floor(i), Math.ceil(i), Math.trunc(i), Math.round(i), Math.min(i, 1), Math.max(i, -1, 2), Math.min(i), Math.max(i),
      Math.abs(wide), Math.sign(wide), Math.round(wide), Math.min(wide, i), Math.max(wide, i), Math.clz32(i), Math.clz32(wide), Math.imul(i, wide), Math.imul(wide, wide),
      Math.sqrt(i), Math.fround(wide + 1), Math.hypot(i), Math.hypot(i, 0), Math.pow(i, 2), Math.pow(i, 3), Math.pow(wide, 2), Math.pow(2, i), i ** 2, 2 ** i,
      isNaN(i), isFinite(wide), Number.isNaN(i), Number.isFinite(wide), Number.isInteger(wide), Number.isSafeInteger(wide), Number.isSafeInteger(limit), Number.isSafeInteger(-limit), Number(wide),
    ].map(show).join(",") + "\n";
  }
  return text;
}

function quotients(i: number): string {
  const a = (i & 15) - 8;
  const u = i & 15;
  const wide = a * 1073741824;
  let text = show(a) + ":";
  for (let j = 0; j < 8; j++) {
    const b = (j & 7) + 1;
    const c = 0 - b;
    const z = (j & 7) - 4;
    text += " " + [
      Math.floor(a / b), Math.ceil(a / b), Math.trunc(a / b), Math.round(a / b), (a / b) | 0, (a / b) >>> 0, ~(a / b), (a / b) << 1, (a / b) >> 1, (a / b) & 7, (a / b) ^ 5,
      Math.floor(u / b), Math.ceil(u / b), Math.trunc(u / b), Math.round(u / b), (u / b) | 0,
      Math.floor(a / c), Math.ceil(a / c), Math.trunc(a / c), Math.round(a / c), (a / c) | 0, Math.floor(u / c), Math.ceil(u / c),
      Math.floor(a / 4), Math.ceil(a / 4), Math.trunc(a / 4), Math.round(a / 4), (a / 4) | 0, Math.floor(a / 1), (a / 1) | 0, Math.floor(a / 3), Math.ceil(a / 3), (a / -4) | 0,
      Math.floor(u / 4), Math.ceil(u / 4), Math.trunc(u / 4), Math.round(u / 4), Math.ceil(u / 3), Math.round(u / 3), Math.ceil(12 / b), Math.round(12 / b), Math.floor(-12 / b),
      (a / z) | 0, (a / z) >>> 0, Math.imul(a / z, 3), Math.clz32(a / z), Math.floor(a / z), Math.round(u / z),
      Math.floor(wide / b), Math.ceil(wide / b), (wide / b) | 0, (wide / z) | 0, (wide / c) >> 1, (wide / 1024) | 0, Math.floor(wide / 1024),
    ].map(show).join(",");
  }
  return text;
}

function int32Quotients(p: number, q: number): string {
  const a = p | 0;
  const b = q | 0;
  return [(a / b) | 0, (a / b) >>> 0, (b / a) | 0, ~(a / b), Math.imul(a / b, 1), Math.clz32(a / b), ((a >>> 0) / 1) | 0, ((a >>> 0) / ((b & 3) + 1)) | 0].map(show).join(",");
}

function staysNegativeZero(one: number): string {
  const bit = one & 1;
  const a = 0 - bit;
  return [
    Object.is(Math.ceil(-1 / 2), -0), Object.is(Math.round(-0.2), -0), Object.is(Math.trunc(-1 / 3), -0), Object.is(Math.floor(0 / -2), -0),
    Object.is(Math.ceil(a / (bit + 1)), -0), Object.is(Math.round(a / (bit + 4)), -0), Object.is(Math.trunc(a / (bit + 2)), -0), Object.is(Math.floor((a + bit) / (a - 1)), -0),
    Object.is(Math.floor(a / (bit + 1)), -1), Object.is(Math.ceil((a + bit) / (bit + 1)), 0), Object.is((a / (bit + 1)) | 0, 0),
  ].join(" ");
}

function powers(k: number): string {
  const isExact = Number.isInteger(k) && k >= 0;
  return [2 ** k, 10 ** k, Math.pow(2, k), Math.pow(10, k)].map(power => (isExact ? show(power) : rounded(power))).join(" ");
}

function powersOfIntegers(exponents: number[]): string {
  let text = "";
  for (let k = -2; k <= 24; k++) text += show(2 ** k) + "," + (k < 0 ? rounded(10 ** k) : show(10 ** k)) + " ";
  for (let i = 0; i < exponents.length; i++) {
    const k = exponents[i] | 0;
    text += show(2 ** k) + "," + (k < 0 ? rounded(Math.pow(10, k)) : show(Math.pow(10, k))) + " ";
  }
  return text;
}

function constantExponents(x: number): string {
  return [x ** 0, x ** 1, x ** 2, x ** 3, x ** 7, x ** 64, x ** 1000, x ** 0.5, x ** -0.5, Math.pow(x, 1000), Math.pow(x, 5)].map(show).join(" ") + " " + [x ** 1001, x ** -1, x ** -2, x ** 1.5].map(rounded).join(" ");
}

class Numbers extends Array<number> {}

function extremesOfNumbers(list: number[]): string {
  return [Math.max(...list), Math.min(...list), Math.max.apply(null, list), Math.min.apply(Math, list)].map(show).join(" ");
}

function extremesOfAnything(list: any): string {
  return [say(() => Math.max(...list)), say(() => Math.min(...list)), say(() => Math.max.apply(null, list)), say(() => Math.min.apply(null, list))].join(" ");
}

const numberLists: [string, () => number[]][] = [
  ["hole", () => [1, , 3] as number[]],
  ["empty", () => []],
  ["one", () => [-7]],
  ["integers", () => [3, -7, 12]],
  ["doubles", () => [1.5, -2.5, 0.25]],
  ["hole among doubles", () => [1.5, , 2.5] as number[]],
  ["only holes", () => new Array<number>(3)],
  ["NaN", () => [1.5, NaN, 9]],
  ["NaN among integers", () => [1, NaN, 9]],
  ["zeros", () => [-0, 0]],
  ["zeros reversed", () => [0, -0]],
  ["negative zero", () => [-0]],
  ["infinities", () => [Infinity, -Infinity, 0]],
  ["undefined", () => [1, undefined, 3] as number[]],
  ["null", () => [1, null, -3] as number[]],
  ["mixed storage", () => [1, 2.5, 2 ** 31, -(2 ** 53)]],
  ["long", () => Array.from({ length: 1000 }, (_, i) => (i * 7919) % 1009)],
  ["long doubles", () => Array.from({ length: 1000 }, (_, i) => ((i * 7919) % 1009) / 8)],
  ["subclass", () => Numbers.from([4, 9])],
  ["own iterator", () => {
    const list = [1, 2];
    (list as any)[Symbol.iterator] = function* () {
      yield 40;
      yield 2;
    };
    return list;
  }],
  ["named property", () => Object.assign([5, 6], { extra: 99 })],
  ["frozen", () => Object.freeze([8, -8]) as number[]],
];

const otherLists: [string, () => unknown][] = [
  ["strings", () => ["3", "10", "-2"]],
  ["text", () => [1, "x"]],
  ["booleans", () => [true, false]],
  ["objects", () => [{ valueOf: () => 42 }, 7]],
  ["bigint", () => [1n]],
  ["string", () => "385"],
  ["set", () => new Set([4, 11])],
  ["array-like", () => ({ length: 2, 0: 5, 1: 9 })],
  ["float array", () => new Float64Array([1.5, 9.25, -0])],
  ["byte array", () => new Int8Array([3, -4])],
  ["undefined", () => undefined],
  ["null", () => null],
  ["number", () => 5],
];

function codeUnits(text: string): string {
  let out = "";
  for (let i = -1; i <= text.length + 1; i++) {
    const unit = text.charCodeAt(i);
    const joined = i & 1 ? text.charCodeAt(i) : i - 2;
    const point = text.codePointAt(i)!;
    out += (unit < 48 ? "a" : "-") + (unit <= 57 ? "b" : "-") + (unit > 47 ? "c" : "-") + (unit >= 48 ? "d" : "-") + (48 > unit ? "e" : "-") + (57 >= unit ? "f" : "-") + (47 < unit ? "g" : "-") + (48 <= unit ? "h" : "-");
    out += (unit < 0 ? "i" : "-") + (unit <= 0 ? "j" : "-") + (unit >= 0 ? "k" : "-") + (unit > -1 ? "l" : "-") + (unit < 65536 ? "m" : "-") + (unit <= -1 ? "n" : "-") + (unit < 2 ** 53 ? "o" : "-") + (unit < 2 ** 54 ? "O" : "-");
    out += (joined < 48 ? "p" : "-") + (joined <= -3 ? "q" : "-") + (joined > 47 ? "r" : "-") + (joined >= -3 ? "s" : "-") + (0 > joined ? "t" : "-") + (0 <= joined ? "u" : "-");
    out += (point < 48 ? "v" : "-") + (point <= 57 ? "w" : "-") + (point > 47 ? "x" : "-") + (point >= 0 ? "y" : "-") + (65536 > point ? "z" : "-") + (point < 2 ** 53 ? "A" : "-") + (point < 2 ** 54 ? "B" : "-") + (2 ** 54 > point ? "C" : "-") + " ";
  }
  return out;
}

function inRadix(value: number, radix: number): string {
  try {
    return (value * 1).toString(radix | 0);
  } catch (error) {
    return (error as Error).name + ": " + (error as Error).message;
  }
}

function integerInRadix(value: number, radix: number): string {
  try {
    return (value | 0).toString(radix | 0);
  } catch (error) {
    return (error as Error).name + ": " + (error as Error).message;
  }
}

function inConstantRadixes(value: number): string {
  const number = value * 1;
  const integer = value | 0;
  return [number.toString(), number.toString(2), number.toString(10), number.toString(16), number.toString(36), number.toString(undefined), integer.toString(), integer.toString(2), integer.toString(36)].join(" ");
}

function joinedInRadix(values: number[], radix: number): string {
  let text = "";
  try {
    for (let i = 0; i < values.length; i++) text += (values[i] * 1).toString(radix | 0) + ";";
  } catch (error) {
    text += (error as Error).name;
  }
  return text;
}

function joinedUntilBadRadix(value: number): string {
  let text = "";
  try {
    for (let radix = 33; radix < 40; radix++) text += "<" + (value * 1).toString(radix) + ">";
  } catch (error) {
    text += (error as Error).name;
  }
  return text;
}

function joinedCounters(): string {
  let text = "";
  for (let i = -3; i < 40; i += 7) text += i.toString() + ":" + i.toString(2) + ":" + (i * 0.5).toString() + ":" + (i * 1000003).toString(36) + ":" + (i * 4294967296.5).toString(16) + ":" + (i / 0).toString(8) + " ";
  return text;
}

function parsed(text: string): string {
  return [Number(text), parseInt(text), parseInt(text, 10), parseInt(text, 16), parseInt(text, 36), parseInt(text, 2), Number.parseInt(text)].map(show).join(",");
}

function parsedInRadix(text: string, radix: number): string {
  return show(parseInt(text, radix | 0)) + "," + show(parseInt(text, radix));
}

function parsedRope(head: string, tail: string): string {
  const rope = head + tail;
  const results = [Number(rope), parseInt(rope), parseInt(rope, 16), Number(rope), Number(`${tail}${head}`), parseInt(`${head}${tail}${tail}`, 10)];
  const padded = "##" + head + tail + "##";
  const part = padded.slice(2, -2);
  results.push(Number(part), parseInt(part), parseInt(part, 16), Number(padded.substring(2, 2 + head.length)), parseInt(padded.slice(2 + head.length, -2), 36));
  return results.map(show).join(",");
}

function randomness(): string {
  const seen = new Set<number>();
  let sum = 0;
  let isInRange = true;
  for (let i = 0; i < 4096; i++) {
    const random = Math.random();
    isInRange &&= random >= 0 && random < 1;
    sum += random;
    seen.add(random);
  }
  return [isInRange, seen.size > 4000, sum > 1800 && sum < 2300].join(" ");
}

const numbers = [
  -0, 0, NaN, Infinity, -Infinity, 2 ** 53, -(2 ** 53), 2 ** 53 - 1, 1, -1, 0.5, -0.5, 1.5, -1.5, 2.5, -2.5, -0.2, 0.49999999999999994, 4294967301, -2147483649, 2147483648,
  65519, 65520, 16777217, 1e21, 1e40, 1e-50, -1e-50, 5e-324, undefined, null,
] as number[];
const numbersOrBooleans = [true, false, 1.5, -0, 7, -7, NaN, Infinity, undefined, null] as (number | boolean)[];
const anything: unknown[] = ["12", " 0x10 ", "", "abc", "-0", "1e400", [], [5], [1, 2], { valueOf: () => -7.5 }, { toString: () => "9" }, new String("8"), new Number(-0), true, null, undefined, 3, -0];
const throwing: unknown[] = [12n, Symbol("s"), { valueOf: () => 1n }, { valueOf() { throw new RangeError("no"); } }];
const exponents = [-1, 23, 1024, 1.5, 0, -0, 1, 22, 308, 309, 1000, 1001, 1023, -1022, -1023, -1074, -1075, 0.5, -0.5, NaN, Infinity, -Infinity, 2147483648, 4294967297, undefined, null] as number[];
const radixes = [1, 2, 3, 8, 10, 16, 36, 37, 0, -1, 4294967298];
const printed = [255, -255, 0, -0, 1, 0.5, -0.1, 123.456, NaN, Infinity, -Infinity, 2 ** 31, -(2 ** 31), 2 ** 53, 1e21, 1e-7, 5e-324];
const texts = [
  "42", "  42  ", "-42", "+42", "0x1f", "-0x1f", "0X1F", "0b101", "0o17", "-0", "", " ", "12px", "1e3", "1e1000", "-1e1000", "Infinity", "-Infinity", "infinity", ".5", "5.", ".", "1_000", "9007199254740993", "1e-400", "z", "Zz", "\n7\t",
  "42\u2603", "\u2003 42\u2003", "\ufeff7", "\u0663", "7\u0660", "\u2603", "1\u20032", "0x1\u2603", "\u221e", "-\u2003" + "1", "1e3\u2003", "Infinity\u2028",
];
const ropes: [string, string][] = [
  ["12", "34"], ["0x", "ff"], ["  ", "7  "], ["1e", "3"], ["", "5"], ["5", ""], ["-", "Infinity"], ["12345678901234567890", "12345678901234567890"], ["0.000000000000000000001", "5"],
  ["\u2003", "42"], ["42", "\u2603"], ["4", "\u0662"], ["\u2603", "\u2603"], ["\ufeff0x", "1F\u2003"],
];

for (let turn = 0; turn < 2; turn++) {
  for (const x of numbers) {
    console.log("number " + show(x) + ": " + exactOfNumber(x).map(show).join(" "));
    console.log("library " + show(x) + ": " + libraryOfNumber(x).map(rounded).join(" "));
    console.log("constant exponents " + show(x) + ": " + constantExponents(x));
  }
  for (const x of numbersOrBooleans) console.log("number or boolean " + show(x) + ": " + ofNumberOrBoolean(x).map(show).join(" "));
  console.log("comparison: " + ofComparison(1, 2).map(show).join(" ") + " | " + ofComparison(2, 1).map(show).join(" ") + " | " + ofComparison(NaN, 1).map(show).join(" "));
  for (let i = 0; i < anything.length; i++) console.log("anything " + i + ": " + ofAnything(anything[i]).map(show).join(" "));
  for (const x of throwing) {
    const y = x as any;
    console.log("throwing: " + [() => Math.abs(y), () => Math.floor(y), () => Math.max(1, y), () => Math.pow(y, 2), () => Math.imul(y, 1), () => Math.sin(y), () => Math.hypot(y), () => isNaN(y), () => isFinite(y), () => Number.isNaN(y), () => Number.isInteger(y), () => Number(y), () => parseInt(y)].map(say).join(" "));
  }
  console.log("no arguments: " + [Math.min(), Math.max(), Math.hypot(), Number(), (Math.abs as any)(), (Math.pow as any)(), (Math.imul as any)(), (Math.clz32 as any)(), (isNaN as any)(), (isFinite as any)(), (Number.isNaN as any)(), (parseInt as any)()].map(show).join(" "));
  console.log("hypot: " + [Math.hypot(NaN, Infinity), Math.hypot(-Infinity, NaN, 1), Math.hypot(NaN, 1, 1), Math.hypot(3, 4), Math.hypot(2, 3, 6), Math.hypot(3, 4, 12, 84), Math.hypot(-0), Math.hypot(-0, -0), Math.hypot(1e308, 1e308), Math.hypot(1e-320, 0)].map(rounded).join(" "));
  console.log("integers:\n" + ofIntegers());
  for (let i = 0; i < 16; i++) console.log("quotients " + quotients(i));
  for (const [p, q] of [[-2147483648, -1], [-2147483648, 0], [-2147483648, 1], [2147483647, 1], [2147483647, -1], [7, 0], [-7, 0], [0, 0], [-7, 2], [1, -2147483648], [0, -5], [-1, 3]])
    console.log("int32 quotients " + p + " " + q + ": " + int32Quotients(p, q));
  console.log("negative zero: " + staysNegativeZero(1) + " | " + staysNegativeZero(0));
  for (const k of exponents) console.log("powers " + show(k) + ": " + powers(k));
  console.log("powers of integers: " + powersOfIntegers([-1075, -1074, -1023, -1022, -324, -323, -1, 0, 22, 23, 308, 309, 1023, 1024, 2147483647, -2147483648]));
  for (const [name, make] of numberLists) console.log("extremes of " + name + ": " + extremesOfNumbers(make()) + " | " + extremesOfAnything(make()));
  for (const [name, make] of otherLists) console.log("extremes of " + name + ": " + extremesOfAnything(make()));
  console.log("literal lists: " + [Math.max(...([1, , 3] as number[])), Math.max.apply(null, []), Math.min.apply(null, []), Math.max(...[]), Math.max(...[2, 9, 4]), Math.min(...[2.5, -9.5]), Math.max(1, ...[5, 3]), Math.max(...[5, 3], 8)].map(show).join(" "));
  for (const text of ["", "0", "/09:", "a\u2603\ud83d\ude00"]) console.log("code units of " + JSON.stringify(text) + ": " + codeUnits(text));
  for (const radix of radixes) {
    console.log("radix " + radix + ": " + printed.map(value => inRadix(value, radix)).join(" "));
    console.log("integers in radix " + radix + ": " + printed.map(value => integerInRadix(value, radix)).join(" "));
    console.log("joined in radix " + radix + ": " + joinedInRadix(printed, radix));
    console.log("parsed in radix " + radix + ": " + ["10", "zz", "0x10", "-11", "9", "\u200310\u2603"].map(text => parsedInRadix(text, radix)).join(" "));
  }
  for (const value of printed) console.log("constant radixes " + show(value) + ": " + inConstantRadixes(value) + " " + joinedUntilBadRadix(value));
  console.log("counters: " + joinedCounters());
  for (const text of texts) console.log("parsed " + JSON.stringify(text) + ": " + parsed(text));
  for (const [head, tail] of ropes) console.log("rope " + JSON.stringify(head) + " " + JSON.stringify(tail) + ": " + parsedRope(head, tail));
  console.log("random: " + randomness());
}
