// Arithmetic where its machine form changes: at 2^53, where integers stop being exact, at 2^31, where int32 ends, and at both zeros.
function show(value: unknown): string {
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  return Object.is(value, -0) ? "-0" : String(value);
}
function attempt(compute: () => unknown): string {
  try {
    return show(compute());
  } catch (error) {
    return (error as Error).name;
  }
}
function list(values: unknown[]): string {
  return values.map(value => show(value)).join(" ");
}

const limits: number[] = [2 ** 53 - 1, 2 ** 53, -(2 ** 53), 2 ** 31, -(2 ** 31), 0, -0, 1, -1];
const counts: number[] = [0, 31, 32, -1];

function binaryOnNumbers(x: number, y: number): string {
  return list([x + y, x - y, x * y, x % y, x ** y]);
}
function stepsOnNumber(x: number): string {
  let up = x;
  let down = x;
  const beforeUp = up++;
  const afterDown = --down;
  return list([beforeUp, up, afterDown, down, -x, +x]);
}
function binaryInLoop(values: number[]): string {
  let text = "";
  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < values.length; j++) {
      const x = values[i]!;
      const y = values[j]!;
      text += show(x + y) + " " + show(x - y) + " " + show(x * y) + " " + show(x % y) + " " + show(x ** y) + ";";
    }
  }
  return text;
}
function powersByConstants(x: number): string {
  return list([x ** 0, x ** 1, x ** 2, x ** 3, x ** 0.5, x ** -0.5, x ** -1, 2 ** x, 1 ** x, 0 ** x, (-0) ** x]);
}

function binaryOnMaybeUndefined(x: number | undefined, y: number | undefined): string {
  return list([x! + y!, x! - y!, x! * y!, x! % y!, x! ** y!, -x!, +y!, x! << y!, x! >>> y!, ~x!]);
}
function binaryOnMaybeNull(x: number | null, y: number | null): string {
  return list([x! + y!, x! - y!, x! * y!, x! % y!, x! ** y!, -x!, +y!, x! << y!, x! >>> y!, ~x!]);
}
function stepsOnMaybeUndefined(x: number | undefined): string {
  let up = x!;
  let down = x!;
  const beforeUp = up++;
  down--;
  return list([beforeUp, up, down]);
}
function stepsOnMaybeNull(x: number | null): string {
  let up = x!;
  let down = x!;
  const beforeUp = up++;
  down--;
  return list([beforeUp, up, down]);
}
function int32IfPresent(bits: number, isPresent: boolean): number | undefined {
  return isPresent ? bits | 0 : undefined;
}
function onOptionalInt32(bits: number, isPresent: boolean): string {
  const x = int32IfPresent(bits, isPresent)!;
  return list([x + 1, x - 1, x * 2, x % 8, x ** 2, -x, x << 1, x >> 1, x >>> 1, x & 255, x | 1, x ^ -1, ~x]);
}

function atExactLimit(bit: number): string {
  const x = (bit & 1) + (2 ** 53 - 1);
  const y = -x;
  return list([x, x + 1, x + 1 === 2 ** 53, x + 1 === x, x + 2, x - 1, x * 1, x * 2, x + x, x - y, y, y - 1, y - 1 === y, y - 2, y + 1, y + x, y - x]);
}
function stepsAtExactLimit(bit: number): string {
  let up = (bit & 1) + (2 ** 53 - 2);
  let down = -(bit & 1) - (2 ** 53 - 2);
  const text = [show(up), show(down)];
  for (let turn = 0; turn < 3; turn++) {
    up++;
    down--;
    text.push(show(up), show(down));
  }
  return text.join(" ");
}
function productsNearExactLimit(bits: number): string {
  const x = (bits & 3) + 94906265;
  const y = -x;
  return list([x * x, x * y, y * y, x * (x - 1), x * 94906265, (x * x) % 1000, x * x + 1, x * x - x * x]);
}
function productsWithZero(bits: number): string {
  const zeroOrOne = bits & 1;
  const minusTwoToOne = (bits & 3) - 2;
  const oneToFour = (bits & 3) + 1;
  const minusFourToMinusOne = -oneToFour;
  return list([
    zeroOrOne * -1,
    -1 * zeroOrOne,
    zeroOrOne * minusTwoToOne,
    minusTwoToOne * oneToFour,
    minusFourToMinusOne * oneToFour,
    minusFourToMinusOne * minusFourToMinusOne,
    minusFourToMinusOne * zeroOrOne,
    0 * minusTwoToOne,
    minusTwoToOne * 0,
    -zeroOrOne,
    -minusTwoToOne,
    -oneToFour,
    -(bits & 0),
  ]);
}
function atInt32Limit(bit: number): string {
  const top = (bit & 1) + (2 ** 31 - 1);
  const bottom = -(bit & 1) - 2 ** 31;
  return list([top, top + 1, top * 2, top * top, top | 0, -top, bottom, bottom - 1, bottom * 2, bottom * bottom, bottom | 0, -bottom, top + bottom, top - bottom, top * bottom]);
}

function remaindersOfNumber(x: number): string {
  return list([x % 1, x % -1, x % 2, x % 8, x % 1024, x % 3, x % -3, x % 0, x % -0, x % 2.5, x % Infinity, x % 2 ** 31, x % 2 ** 32, x % 2 ** 53]);
}
function remaindersOfInt32(value: number): string {
  const x = value | 0;
  const nonNegative = value & 0x7fffffff;
  const zeroToThree = value & 3;
  const minusOneOrZero = (value & 1) - 1;
  return list([
    x % 1,
    x % -1,
    x % 2,
    x % 8,
    x % -8,
    x % 3,
    x % 0,
    x % zeroToThree,
    x % minusOneOrZero,
    x % (zeroToThree + 1),
    x % (minusOneOrZero - 1),
    nonNegative % 1,
    nonNegative % 8,
    nonNegative % 3,
    nonNegative % -3,
    nonNegative % zeroToThree,
    nonNegative % (zeroToThree + 1),
    nonNegative % (minusOneOrZero - 1),
  ]);
}
function remaindersOfWideIntegers(bits: number): string {
  const x = (bits & 7) + 2 ** 52;
  const y = -x;
  const divisor = (bits & 7) + 2 ** 33;
  return list([x % 2, x % 1024, x % 3, x % 2 ** 31, x % 2 ** 40, x % divisor, x % -divisor, y % 2, y % 1024, y % 3, y % 2 ** 40, y % divisor, y % x, x % y]);
}
function remaindersInLoop(values: number[], divisor: number): string {
  let text = "";
  for (let i = 0; i < values.length; i++) text += show(values[i]! % divisor) + " " + show(i % divisor) + " " + show(i % 4) + " " + show(-i % 4) + ";";
  return text;
}

function bitsOfNumbers(x: number, y: number): string {
  return list([x & y, x | y, x ^ y, ~x]);
}
function shiftsOfNumber(x: number, count: number): string {
  return list([x << count, x >> count, x >>> count]);
}
function shiftsByConstants(x: number): string {
  return list([x << 0, x << 31, x << 32, x << -1, x >> 0, x >> 31, x >> 32, x >> -1, x >>> 0, x >>> 31, x >>> 32, x >>> -1]);
}
function shiftsOfInt32(value: number, by: number): string {
  const x = value | 0;
  const count = by | 0;
  return list([x << count, x >> count, x >>> count, x << 31, x >> 31, x >>> 31, x << 32, x >> 32, x >>> 32, x << -1, x >> -1, x >>> -1]);
}

function climbPastExactLimit(): string {
  let text = "";
  let turns = 0;
  for (let i = 2 ** 53 - 3; turns < 6; i++, turns++) text += show(i) + " ";
  return text;
}
function descendPastExactLimit(): string {
  let text = "";
  let turns = 0;
  for (let i = -(2 ** 53) + 3; turns < 6; i--, turns++) text += show(i) + " ";
  return text;
}
function climbByTwoPastExactLimit(): string {
  let text = "";
  let turns = 0;
  for (let i = 2 ** 53 - 5; turns < 6; i += 2, turns++) text += show(i) + " ";
  return text;
}
function crossInt32Limits(): string {
  let text = "";
  for (let i = 2 ** 31 - 3; i < 2 ** 31 + 3; i++) text += show(i) + ":" + show(i | 0) + " ";
  for (let i = -(2 ** 31) + 3; i > -(2 ** 31) - 3; i--) text += show(i) + ":" + show(i | 0) + " ";
  return text;
}
function sumOfCounters(from: number, to: number): string {
  let sum = 0;
  let turns = 0;
  for (let i = from; i < to && turns < 8; i++) {
    sum += i;
    turns++;
  }
  return show(sum) + " in " + turns;
}
function sumOfDescendingCounters(from: number, to: number): string {
  let sum = 0;
  let turns = 0;
  for (let i = from; i > to && turns < 8; i--) {
    sum += i;
    turns++;
  }
  return show(sum) + " in " + turns;
}

function onBooleans(x: boolean, y: boolean): string {
  const a = x as any;
  const b = y as any;
  let up = a;
  let down = b;
  up++;
  down--;
  return list([a + b, a - b, a * b, a % b, a ** b, -a, +a, ~a, a << b, a >> b, a >>> b, up, down]);
}
function onBigInts(x: bigint, y: bigint): string {
  let up = x;
  let down = y;
  up++;
  down--;
  return list([x + y, x - y, x * y, -x, ~x, up, down]) + " " + attempt(() => x % y) + " " + attempt(() => x ** y);
}
function onStrings(x: string, y: string): string {
  const a = x as any;
  const b = y as any;
  return list([x + y, a - b, a * b, a % b, a ** b, -a, +a, ~a, a << b]);
}
function addTextAndNumber(text: string, x: number): string {
  return list([text + x, x + text, text + x + x, x + x + text, "<" + x + ">", x + "", "" + -x]);
}
function addMaybeStrings(x: string | undefined, y: string | null): string {
  return list([x! + y!, y! + x!, x! + "!", "?" + y!, x! + x!, y! + y!]);
}
function addMaybeStringAndValue(x: string | undefined, y: number | boolean | null): string {
  return list([x! + y, y + x!]);
}
function addLiteral(method: "get" | "post", path: string, port: number): string {
  return list([method + path, path + method, method + method, method + port, port + method, method + ":" + port]);
}
function addInLoop(texts: string[], maybeTexts: (string | undefined)[], numbers: number[]): string {
  let all = "";
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]!;
    const maybeText = maybeTexts[i]!;
    const x = numbers[i]!;
    all += show(text + x) + show(x + text) + show(text + maybeText) + show(maybeText + maybeText) + show(maybeText + "|") + show((maybeText as any) + x) + ";";
  }
  return all;
}

type Binary = (x: unknown, y: unknown) => unknown;
type Unary = (x: unknown) => unknown;
const untypedBinary: [string, Binary][] = [
  ["+", (x, y) => (x as any) + (y as any)],
  ["-", (x, y) => (x as any) - (y as any)],
  ["*", (x, y) => (x as any) * (y as any)],
  ["%", (x, y) => (x as any) % (y as any)],
  ["**", (x, y) => (x as any) ** (y as any)],
  ["<<", (x, y) => (x as any) << (y as any)],
  [">>", (x, y) => (x as any) >> (y as any)],
  [">>>", (x, y) => (x as any) >>> (y as any)],
];
const untypedUnary: [string, Unary][] = [
  ["-x", x => -(x as any)],
  ["+x", x => +(x as any)],
  ["~x", x => ~(x as any)],
  ["++x", x => {
    let value = x as any;
    return ++value;
  }],
  ["--x", x => {
    let value = x as any;
    return --value;
  }],
  ["x++", x => {
    let value = x as any;
    return value++;
  }],
];
function untypedInLoop(values: unknown[]): string {
  let text = "";
  for (let i = 0; i < values.length; i++) {
    const x = values[i] as any;
    for (let j = 0; j < values.length; j++) {
      const y = values[j] as any;
      text += show(x + y) + " " + show(x - y) + " " + show(x * y) + " " + show(x % y) + " " + show(x ** y) + " " + show(x << y) + " " + show(x >>> y) + ";";
    }
  }
  return text;
}
function untypedStepsInLoop(values: unknown[]): string {
  let text = "";
  for (let i = 0; i < values.length; i++) {
    let up = values[i] as any;
    let down = values[i] as any;
    up++;
    down--;
    text += show(up) + " " + show(down) + " " + show(-(values[i] as any)) + ";";
  }
  return text;
}

class Amount {
  cents: number;
  constructor(cents: number) {
    this.cents = cents;
  }
  valueOf(): number {
    return this.cents;
  }
}
function onAmounts(x: Amount, y: Amount): string {
  const a = x as any;
  const b = y as any;
  return list([a + b, a - b, a * b, a % b, a ** b, -a, +a, a << b, a + "", "" + b]);
}
function logConversionOrder(): void {
  const calls: string[] = [];
  const operand = (name: string, value: unknown): unknown => ({
    valueOf() {
      calls.push(name);
      return value;
    },
  });
  const failing = (name: string): unknown => ({
    valueOf() {
      calls.push(name);
      throw new RangeError(name);
    },
  });
  for (const [name, apply] of untypedBinary) {
    const results = [
      attempt(() => apply(operand("a", 6), operand("b", 2))),
      attempt(() => apply(operand("c", 6n), operand("d", 2))),
      attempt(() => apply(operand("e", "6"), operand("f", 2n))),
      attempt(() => apply(failing("g"), operand("h", 2))),
      attempt(() => apply(operand("i", 6), failing("j"))),
      attempt(() => apply(operand("k", Symbol.iterator), operand("l", 2))),
    ];
    console.log("order", name, results.join(" "), calls.join(""));
    calls.length = 0;
  }
  for (const [name, apply] of untypedUnary) {
    console.log("order", name, attempt(() => apply(operand("a", 6))), attempt(() => apply(operand("b", 6n))), attempt(() => apply(failing("c"))), calls.join(""));
    calls.length = 0;
  }
}

const numbers: number[] = [...limits, 2 ** 31 - 1, 7, -7, 5.5, -5.5, 1e21, NaN, Infinity, -Infinity];
for (const x of limits) {
  for (const y of limits) console.log("numbers", show(x), show(y), binaryOnNumbers(x, y), "bits", bitsOfNumbers(x, y));
}
console.log("in a loop", binaryInLoop(limits));
for (const x of numbers) {
  console.log("steps", show(x), stepsOnNumber(x));
  console.log("powers", show(x), powersByConstants(x));
  console.log("remainders", show(x), remaindersOfNumber(x));
  console.log("int32 remainders", show(x), remaindersOfInt32(x));
  console.log("constant shifts", show(x), shiftsByConstants(x));
  for (const count of counts) console.log("shifts", show(x), count, shiftsOfNumber(x, count), "int32", shiftsOfInt32(x, count));
}
for (const divisor of [1, 2, 8, 3, 0, -0, -4, 2.5, 2 ** 31, NaN]) console.log("remainders in a loop", show(divisor), remaindersInLoop(numbers, divisor));

const maybeUndefined: (number | undefined)[] = [undefined, 2 ** 53, -(2 ** 31), 0, -0, 1];
const maybeNull: (number | null)[] = [null, 2 ** 53, -(2 ** 31), 0, -0, 1];
for (const x of maybeUndefined) {
  console.log("steps on undefined", show(x), stepsOnMaybeUndefined(x));
  for (const y of maybeUndefined) console.log("undefined", show(x), show(y), binaryOnMaybeUndefined(x, y));
}
for (const x of maybeNull) {
  console.log("steps on null", show(x), stepsOnMaybeNull(x));
  for (const y of maybeNull) console.log("null", show(x), show(y), binaryOnMaybeNull(x, y));
}
for (const bits of [0, -1, 2 ** 31 - 1, -(2 ** 31)]) console.log("optional int32", bits, onOptionalInt32(bits, true), "|", onOptionalInt32(bits, false));

for (let bits = 0; bits < 4; bits++) {
  console.log("exact limit", bits, atExactLimit(bits));
  console.log("steps at exact limit", bits, stepsAtExactLimit(bits));
  console.log("products", bits, productsNearExactLimit(bits));
  console.log("zero products", bits, productsWithZero(bits));
  console.log("int32 limit", bits, atInt32Limit(bits));
}
for (let bits = 0; bits < 8; bits++) console.log("wide remainders", bits, remaindersOfWideIntegers(bits));

console.log("counters", climbPastExactLimit(), "|", descendPastExactLimit(), "|", climbByTwoPastExactLimit());
console.log("counters", crossInt32Limits());
console.log("counters", sumOfCounters(2 ** 31 - 3, 2 ** 31 + 3), sumOfCounters(-(2 ** 31) - 3, -(2 ** 31) + 3), sumOfCounters(2 ** 53 - 3, 2 ** 53 + 3), sumOfCounters(-0, 3));
console.log("counters", sumOfDescendingCounters(2 ** 31 + 3, 2 ** 31 - 3), sumOfDescendingCounters(-(2 ** 31) + 3, -(2 ** 31) - 3), sumOfDescendingCounters(-(2 ** 53) + 3, -(2 ** 53) - 3));

for (const x of [false, true]) for (const y of [false, true]) console.log("booleans", x, y, onBooleans(x, y));
const bigints: bigint[] = [0n, 1n, -1n, 3n, 2n ** 31n, 2n ** 53n, -(2n ** 53n), 2n ** 64n];
for (const x of bigints) for (const y of bigints) console.log("bigints", show(x), show(y), onBigInts(x, y));
const texts: string[] = ["", "7", "-0", "9007199254740993", "0x10", " 12 ", "x", "é"];
for (const x of texts) {
  for (const y of texts) console.log("strings", show(x), show(y), onStrings(x, y));
  for (const y of limits) console.log("text and number", addTextAndNumber(x, y));
}
for (const x of [undefined, "", "a"]) {
  for (const y of [null, "", "b"]) console.log("maybe strings", addMaybeStrings(x, y));
  for (const y of [null, true, 0, -0, 2 ** 53, 1.5]) console.log("maybe string and value", addMaybeStringAndValue(x, y));
}
console.log("literals", addLiteral("get", "/", 80), addLiteral("post", "", -0));
console.log("adding in a loop", addInLoop(["a", "", "é", "b"], ["x", undefined, "", "y"], [2 ** 53, -0, 1.5, -(2 ** 31)]));

const withoutBigInts: unknown[] = [2 ** 53, -(2 ** 31), 2 ** 31 - 1, -0, 1.5, undefined, null, true, false, "7", "", "x", { valueOf: () => 2 }, { toString: () => "9" }, [5]];
const mixed: unknown[] = [...withoutBigInts, 3n, -(2n ** 53n), { valueOf: () => 2n }];
for (const [name, apply] of untypedBinary) {
  for (const x of mixed) console.log("untyped", name, attempt(() => String(x)), mixed.map(y => attempt(() => apply(x, y))).join(" "));
}
for (const [name, apply] of untypedUnary) console.log("untyped", name, mixed.map(x => attempt(() => apply(x))).join(" "));
console.log("untyped in a loop", untypedInLoop(withoutBigInts));
console.log("untyped steps in a loop", untypedStepsInLoop([...numbers, 2 ** 31 - 1, 2 ** 31 - 2, -(2 ** 31) + 1, 3n, "4", null, undefined, true]));
console.log("objects", onAmounts(new Amount(2 ** 53), new Amount(1)), onAmounts(new Amount(-0), new Amount(0)), onAmounts(new Amount(7), new Amount(-2)));
logConversionOrder();
