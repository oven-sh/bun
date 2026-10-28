function show(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

function ofString(text: string): number {
  return Number(text);
}
function ofOptionalString(text: string | null | undefined): number {
  return Number(text);
}
function ofAnything(value: unknown): number {
  return Number(value);
}

const texts = [
  "42", "2", "", " ", "  12  ", "\n7\t", "-0", "+5", "-5", "0x1f", "0b101", "0o17", "1e3", "1e400", "-1e400", ".5", "5.", "1_000", "12px", "abc",
  "Infinity", "-Infinity", "infinity", "NaN", "9007199254740993", "123456789012345678901234567890", "0.1", "00012", "１２", " 12﻿", "1 2", "--1", "0x", "١٢",
];
console.log(texts.map(text => show(ofString(text))).join(" "));
console.log(texts.map(text => show(ofOptionalString(text))).join(" "));
console.log(texts.map(text => show(ofAnything(text))).join(" "));

const ropes = texts.map((text, index) => text + (index & 1 ? "" : "0") + (index & 2 ? "" : "1"));
console.log(ropes.map(text => show(ofString(text))).join(" "));
console.log(ropes.map(text => show(ofAnything(text))).join(" "));

console.log([undefined, null].map(value => show(ofOptionalString(value))).join(" "));
const others: unknown[] = [
  undefined, null, true, false, 0, -0, 1.5, NaN, 7n, -7n, 2n ** 70n, [], [5], [1, 2], {}, { valueOf: () => 8 }, { toString: () => "9" }, new Date(86400000),
  new Number(3), new String("4"), new Boolean(true), () => 1,
];
console.log(others.map(value => show(ofAnything(value))).join(" "));

for (const value of [Symbol("s"), { valueOf: () => Symbol("t") }, { valueOf() { throw new RangeError("no"); } }, Object.create(null)]) {
  try {
    console.log(show(ofAnything(value)));
  } catch (error) {
    console.log((error as Error).name);
  }
}
console.log(show(Number()), show((Number as (...values: unknown[]) => number)("3", "4")), show(new Number("6").valueOf()));
