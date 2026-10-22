// A switch over integer cases matches by ===, whatever the static type of its subject: 5.0 takes case 5, -0 takes case 0, and "5", 5n, null and an object with valueOf take the default.
function ofNumber(subject: number): string {
  switch (subject) {
    case 0: return "zero";
    case 5: return "five";
    case -7: return "minus-seven";
    case 1099511627776: return "2**40";
    default: return "other";
  }
}
function ofOptionalNumber(subject: number | undefined): string {
  switch (subject) {
    case 0: return "zero";
    case 5: return "five";
    case -7: return "minus-seven";
    case 1099511627776: return "2**40";
    default: return "other";
  }
}
function ofNullableNumber(subject: number | null): string {
  switch (subject) {
    case 0: return "zero";
    case 5: return "five";
    case -7: return "minus-seven";
    case 1099511627776: return "2**40";
    default: return "other";
  }
}
function ofUnknown(subject: unknown): string {
  switch (subject) {
    case 0: return "zero";
    case 5: return "five";
    case -7: return "minus-seven";
    case 1099511627776: return "2**40";
    default: return "other";
  }
}
function ofNumberOrString(subject: number | string): string {
  switch (subject) {
    case 0: return "zero";
    case 5: return "five";
    case -7: return "minus-seven";
    case 1099511627776: return "2**40";
    default: return "other";
  }
}

function isFiveNumber(subject: number): boolean {
  switch (subject) {
    case 5: return true;
    default: return false;
  }
}
function isFiveOptional(subject: number | undefined): boolean {
  switch (subject) {
    case 5: return true;
    default: return false;
  }
}
function isFiveUnknown(subject: unknown): boolean {
  switch (subject) {
    case 5: return true;
    default: return false;
  }
}
function isZeroUnknown(subject: unknown): boolean {
  switch (subject) {
    case -0: return true;
    default: return false;
  }
}
function hasNoCase(subject: unknown): string {
  switch (subject) {
    default: return "default";
  }
}
function withSharedTargets(subject: unknown): string {
  let text = "";
  switch (subject) {
    case 1:
    case 2:
      text += "low ";
    case 5:
      text += "up-to-five";
      break;
    default:
      text += "other ";
    case 9:
      text += "nine-or-other";
  }
  return text;
}

function ofInt32Elements(values: Int32Array, count: number): string {
  let text = "";
  for (let i = 0; i < count; i++) {
    switch (values[i]) {
      case 0: text += "z"; break;
      case 5: text += "f"; break;
      case -7: text += "m"; break;
      default: text += "-";
    }
  }
  return text;
}
function ofFloat64Elements(values: Float64Array, count: number): string {
  let text = "";
  for (let i = 0; i < count; i++) {
    switch (values[i]) {
      case 0: text += "z"; break;
      case 5: text += "f"; break;
      case 1099511627776: text += "w"; break;
      default: text += "-";
    }
  }
  return text;
}

function ofString(subject: string): string {
  switch (subject as any) {
    case 0: return "zero";
    case 5: return "five";
    default: return "other";
  }
}
function ofStringLiteral(subject: "5" | "0"): string {
  switch (subject as any) {
    case 0: return "zero";
    case 5: return "five";
    default: return "other";
  }
}
function ofBoolean(subject: boolean): string {
  switch (subject as any) {
    case 0: return "zero";
    case 1: return "one";
    default: return "other";
  }
}
function ofBigInt(subject: bigint): string {
  switch (subject as any) {
    case 0: return "zero";
    case 5: return "five";
    default: return "other";
  }
}
let conversions = 0;
type HasValue = { valueOf(): number };
function ofObject(subject: HasValue): string {
  switch (subject as any) {
    case 0: return "zero";
    case 5: return "five";
    default: return "other";
  }
}

const doubles = new Float64Array([5, -0, 5.5, NaN, 2 ** 40, 0, -7]);
const numbers: number[] = [5, 5.0, -0, 0, 5.5, NaN, 2 ** 40, -7, -7.5, -5, Infinity, -Infinity, 2 ** 31, 2 ** 32, 2 ** 32 + 5, 2 ** 40 + 1, 2 ** 53, 2 ** 62, 2 ** 63, -(2 ** 63), 1e300, 5e-324,
  10 / 2, Math.sqrt(25), 0.1 + 0.2, Number("5"), doubles[0]!, doubles[1]!, doubles[2]!, doubles[3]!, doubles[4]!, doubles[5]!, doubles[6]!];
const five: HasValue = { valueOf() { conversions++; return 5; } };
const others: unknown[] = ["5", "", "five", null, undefined, 5n, 0n, true, false, five, [5], new Number(5), Symbol.iterator];
const everything: unknown[] = [...numbers, ...others];

console.log(numbers.map(subject => ofNumber(subject)).join(" "));
console.log([...numbers, undefined].map(subject => ofOptionalNumber(subject)).join(" "));
console.log([...numbers, null].map(subject => ofNullableNumber(subject)).join(" "));
console.log(everything.map(subject => ofUnknown(subject)).join(" "));
console.log([...numbers, "5", "0", ""].map(subject => ofNumberOrString(subject)).join(" "));
console.log(numbers.map(subject => isFiveNumber(subject)).join(" "));
console.log([...numbers, undefined].map(subject => isFiveOptional(subject)).join(" "));
console.log(everything.map(subject => isFiveUnknown(subject)).join(" "));
console.log(everything.map(subject => isZeroUnknown(subject)).join(" "));
console.log(everything.map(subject => hasNoCase(subject)).join(" "));
console.log([1, 2, 5, 9, 3, 1.5, "1", undefined, 2n].map(subject => withSharedTargets(subject)).join(", "));
console.log(ofInt32Elements(new Int32Array([5, 0, -7, 7, 2147483647, -2147483648]), 9));
console.log(ofFloat64Elements(doubles, 10));
console.log(ofString("5"), ofString("0"), ofString(""), ofStringLiteral("5"), ofStringLiteral("0"), ofBoolean(false), ofBoolean(true), ofBigInt(5n), ofBigInt(0n), ofObject(five), conversions);
