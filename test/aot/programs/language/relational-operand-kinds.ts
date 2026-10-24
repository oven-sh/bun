// < <= > >= over operands of every kind, typed precisely, as optionals and as unknown, and integer loop counters against fractions, NaN and infinities on either side.
function digit(less: boolean, lessOrEqual: boolean, greater: boolean, greaterOrEqual: boolean): string {
  return "0123456789abcdef"[(less ? 1 : 0) | (lessOrEqual ? 2 : 0) | (greater ? 4 : 0) | (greaterOrEqual ? 8 : 0)]!;
}
function table<A, B>(lefts: A[], rights: B[], compare: (a: A, b: B) => string): string {
  let text = "";
  for (const a of lefts) {
    for (const b of rights) text += compare(a, b);
    text += " ";
  }
  return text;
}

type HasValue = { valueOf(): number };
const five: HasValue = { valueOf() { return 5; } };
const numbers: number[] = [-1, 0, -0, 1.5, NaN, Infinity, 2 ** 53];
const strings: string[] = ["a", "b", "", "ab", "10", "9"];
const bigints: bigint[] = [10n, 0n, -1n, 2n ** 53n + 1n];
const everyKind: unknown[] = [...numbers, undefined, null, true, ...strings, 10n, five];

function compareUnknown(a: unknown, b: unknown): string {
  return digit((a as any) < (b as any), (a as any) <= (b as any), (a as any) > (b as any), (a as any) >= (b as any));
}
console.log(table(everyKind, everyKind, compareUnknown));

function compareNumbers(a: number, b: number): string {
  return digit(a < b, a <= b, a > b, a >= b);
}
function compareInt32(a: number, b: number): string {
  const x = a | 0;
  const y = b | 0;
  return digit(x < y, x <= y, x > y, x >= y);
}
function compareUint32(a: number, b: number): string {
  const x = a >>> 0;
  const y = b >>> 0;
  return digit(x < y, x <= y, x > y, x >= y);
}
function compareInt32WithNumber(a: number, b: number): string {
  const x = a | 0;
  return digit(x < b, x <= b, x > b, x >= b) + digit(b < x, b <= x, b > x, b >= x);
}
function compareStrings(a: string, b: string): string {
  return digit(a < b, a <= b, a > b, a >= b);
}
function compareBooleans(a: boolean, b: boolean): string {
  return digit(a < b, a <= b, a > b, a >= b);
}
function compareBigInts(a: bigint, b: bigint): string {
  return digit(a < b, a <= b, a > b, a >= b);
}
function compareNumberWithBigInt(a: number, b: bigint): string {
  return digit(a < b, a <= b, a > b, a >= b) + digit(b < a, b <= a, b > a, b >= a);
}
function compareObjects(a: HasValue, b: HasValue): string {
  return digit(a < b, a <= b, a > b, a >= b);
}
function compareNumberWithString(a: number, b: string): string {
  return digit((a as any) < b, (a as any) <= b, (a as any) > b, (a as any) >= b) + digit(b < (a as any), b <= (a as any), b > (a as any), b >= (a as any));
}
function compareNumberWithBoolean(a: number, b: boolean): string {
  return digit((a as any) < b, (a as any) <= b, (a as any) > b, (a as any) >= b) + digit(b < (a as any), b <= (a as any), b > (a as any), b >= (a as any));
}
function compareUndefinedWithNull(a: undefined, b: null): string {
  return digit((a as any) < (b as any), (a as any) <= (b as any), (a as any) > (b as any), (a as any) >= (b as any)) + digit((b as any) < (a as any), (b as any) <= (a as any), (b as any) > (a as any), (b as any) >= (a as any));
}
console.log(table(numbers, numbers, compareNumbers));
console.log(table([-1, 0, 1, 2147483647, -2147483648], [-1, 0, 1, 2147483647, -2147483648], compareInt32));
console.log(table([-1, 0, 1, 2147483647, 4294967295], [-1, 0, 1, 2147483647, 4294967295], compareUint32));
console.log(table([-1, 0, 1, 2147483647], numbers, compareInt32WithNumber));
console.log(table(strings, strings, compareStrings));
console.log(table([false, true], [false, true], compareBooleans));
console.log(table(bigints, bigints, compareBigInts));
console.log(table(numbers, bigints, compareNumberWithBigInt));
console.log(table(numbers, strings, compareNumberWithString));
console.log(table(numbers, [false, true], compareNumberWithBoolean));
console.log(compareUndefinedWithNull(undefined, null));

const conversions: string[] = [];
const first: HasValue = { valueOf() { conversions.push("first"); return 1; } };
const second: HasValue = { valueOf() { conversions.push("second"); return 2; } };
console.log(compareObjects(first, second), compareObjects(second, first), compareObjects(five, five), compareUnknown(first, second), conversions.join(" "));

function compareOptionalNumbers(a: number | undefined, b: number | undefined): string {
  return digit(a! < b!, a! <= b!, a! > b!, a! >= b!);
}
function compareNullableNumbers(a: number | null, b: number | null): string {
  return digit(a! < b!, a! <= b!, a! > b!, a! >= b!);
}
function compareOptionalWithNullableNumber(a: number | undefined, b: number | null): string {
  return digit(a! < b!, a! <= b!, a! > b!, a! >= b!) + digit(b! < a!, b! <= a!, b! > a!, b! >= a!);
}
function compareOptionalStrings(a: string | undefined, b: string | undefined): string {
  return digit(a! < b!, a! <= b!, a! > b!, a! >= b!);
}
function compareNullableStrings(a: string | null, b: string | null): string {
  return digit(a! < b!, a! <= b!, a! > b!, a! >= b!);
}
console.log(table([...numbers, undefined], [...numbers, undefined], compareOptionalNumbers));
console.log(table([...numbers, null], [...numbers, null], compareNullableNumbers));
console.log(table([...numbers, undefined], [...numbers, null], compareOptionalWithNullableNumber));
console.log(table([...strings, undefined], [...strings, undefined], compareOptionalStrings));
console.log(table([...strings, null], [...strings, null], compareNullableStrings));

function compareElements(values: Int32Array | Uint8Array, count: number): string {
  let text = "";
  for (let i = 0; i < count; i++) {
    const x = values[i]!;
    for (let j = 0; j < count; j++) {
      const y = values[j]!;
      text += digit(x < y, x <= y, x > y, x >= y);
    }
    text += ":" + digit(x < i, x <= i, x > i, x >= i) + digit(i < x, i <= x, i > x, i >= x) + " ";
  }
  return text;
}
function compareSignedElements(values: Int32Array, count: number): string {
  let text = "";
  for (let i = -2; i < count; i++) {
    const x = values[i + 2]!;
    const y = values[count - i]!;
    text += digit(x < y, x <= y, x > y, x >= y) + digit(x < i, x <= i, x > i, x >= i) + digit(i < x, i <= x, i > x, i >= x) + " ";
  }
  return text;
}
function compareUnsignedElements(values: Uint8Array, count: number): string {
  let text = "";
  for (let i = 0; i < count; i++) {
    const x = values[i]!;
    const y = values[count - i]!;
    text += digit(x < y, x <= y, x > y, x >= y) + digit(x < i, x <= i, x > i, x >= i) + digit(i < x, i <= x, i > x, i >= x) + " ";
  }
  return text;
}
console.log(compareElements(new Int32Array([0, -1, 3, 2147483647, -2147483648]), 7));
console.log(compareElements(new Uint8Array([0, 1, 3, 255]), 6));
console.log(compareSignedElements(new Int32Array([0, -1, 3, 2147483647, -2147483648]), 6));
console.log(compareUnsignedElements(new Uint8Array([0, 1, 3, 255]), 6));

function compareWithLetter(text: string): string {
  return digit(text < "b", text <= "b", text > "b", text >= "b") + digit("b" < text, "b" <= text, "b" > text, "b" >= text);
}
function compareOptionalWithLetter(text: string | undefined): string {
  return digit(text! < "b", text! <= "b", text! > "b", text! >= "b") + digit("b" < text!, "b" <= text!, "b" > text!, "b" >= text!);
}
function compareStringOrNumberWithLetter(value: string | number): string {
  return digit((value as any) < "b", (value as any) <= "b", (value as any) > "b", (value as any) >= "b") + digit("b" < (value as any), "b" <= (value as any), "b" > (value as any), "b" >= (value as any));
}
function compareUnknownWithLetter(value: unknown): string {
  return digit((value as any) < "b", (value as any) <= "b", (value as any) > "b", (value as any) >= "b") + digit("b" < (value as any), "b" <= (value as any), "b" > (value as any), "b" >= (value as any));
}
function compareUnknownWithDigit(value: unknown): string {
  return digit((value as any) < "5", (value as any) <= "5", (value as any) > "5", (value as any) >= "5") + digit("5" < (value as any), "5" <= (value as any), "5" > (value as any), "5" >= (value as any));
}
function concatenate(a: string, b: string): string {
  return a + b;
}
const texts: string[] = ["", "a", "b", "c", "ab", "ba", "bb", "B", "\u00e9", "\u0100", "b\u0100", "\ud83d\ude00",
  concatenate("b", "cdefghijklmnop"), concatenate("", "b"), concatenate("a", "zzzzzzzzzzzzzzzz"), concatenate("b\u0100", "cdefghijklmnop"),
  "abcdefghijklmnop".slice(1, 9), "abcdefghijklmnop".slice(1, 2), "\u0100bcdefghijklmnop".slice(1, 9)];
console.log(texts.map(text => compareWithLetter(text)).join(" "));
console.log([...texts, undefined].map(text => compareOptionalWithLetter(text)).join(" "));
console.log([...texts, ...numbers].map(value => compareStringOrNumberWithLetter(value)).join(" "));
console.log([...texts, ...everyKind].map(value => compareUnknownWithLetter(value)).join(" "));
console.log([...texts, ...everyKind].map(value => compareUnknownWithDigit(value)).join(" "));

function countersAgainstConstants(): string {
  let text = "";
  for (let i = -2; i <= 3; i++) {
    text += digit(i < 2.5, i <= 2.5, i > 2.5, i >= 2.5) + digit(2.5 < i, 2.5 <= i, 2.5 > i, 2.5 >= i);
    text += digit(i < -0.5, i <= -0.5, i > -0.5, i >= -0.5) + digit(-0.5 < i, -0.5 <= i, -0.5 > i, -0.5 >= i);
    text += digit(i < NaN, i <= NaN, i > NaN, i >= NaN) + digit(NaN < i, NaN <= i, NaN > i, NaN >= i);
    text += digit(i < Infinity, i <= Infinity, i > Infinity, i >= Infinity) + digit(Infinity < i, Infinity <= i, Infinity > i, Infinity >= i);
    text += digit(i < -Infinity, i <= -Infinity, i > -Infinity, i >= -Infinity) + digit(-Infinity < i, -Infinity <= i, -Infinity > i, -Infinity >= i);
    text += digit(i < 1e300, i <= 1e300, i > 1e300, i >= 1e300) + digit(1e300 < i, 1e300 <= i, 1e300 > i, 1e300 >= i);
    text += digit(i < -1e300, i <= -1e300, i > -1e300, i >= -1e300) + digit(-1e300 < i, -1e300 <= i, -1e300 > i, -1e300 >= i);
    text += digit(i < -0, i <= -0, i > -0, i >= -0) + digit(-0 < i, -0 <= i, -0 > i, -0 >= i) + " ";
  }
  return text;
}
function countersAgainstVariable(bound: number): string {
  let text = "";
  for (let i = -2; i <= 3; i++) text += digit(i < bound, i <= bound, i > bound, i >= bound) + digit(bound < i, bound <= i, bound > i, bound >= i);
  return text;
}
function wideCountersAgainstVariable(bound: number): string {
  let text = "";
  for (let i = 2251799813685246; i <= 2251799813685250; i++) text += digit(i < bound, i <= bound, i > bound, i >= bound) + digit(bound < i, bound <= i, bound > i, bound >= i);
  return text;
}
function countIterationsBelow(bound: number): number {
  let iterations = 0;
  for (let i = 0; i < bound && i < 100; i++) iterations++;
  for (let i = 0; bound > i && 100 > i; i++) iterations++;
  return iterations;
}
const bounds: number[] = [2.5, -0.5, NaN, Infinity, -Infinity, 1e300, -1e300, 0, -0, 3, -2, 2 ** 53, 2 ** 62, -(2 ** 62), 2 ** 62 - 512, 2 ** 63, -(2 ** 63)];
console.log(countersAgainstConstants());
console.log(bounds.map(bound => countersAgainstVariable(bound)).join(" "));
console.log([2251799813685248.5, 2251799813685247.5, 2251799813685248, ...bounds].map(bound => wideCountersAgainstVariable(bound)).join(" "));
console.log(bounds.map(bound => countIterationsBelow(bound)).join(" "));

function countHoldsAgainstNaN(): number {
  let count = 0;
  for (let i = -1000; i < 1000; i++) {
    if (i < NaN) count++;
    if (NaN > i) count++;
  }
  return count;
}
function countHoldsAgainst(bound: number): number {
  let count = 0;
  for (let i = -1000; i < 1000; i++) {
    if (i < bound) count++;
    if (bound > i) count++;
  }
  return count;
}
function isStringLess(a: string, b: string): boolean {
  return a < b;
}
function isStringLessThanNumber(a: string, b: number): boolean {
  return (a as any) < b;
}
console.log(countHoldsAgainstNaN(), countHoldsAgainst(NaN), countHoldsAgainst(0.5));
console.log(isStringLess("10", "9"), isStringLessThanNumber("10", 9), compareUnknown("10", "9"), compareUnknown("10", 9));
