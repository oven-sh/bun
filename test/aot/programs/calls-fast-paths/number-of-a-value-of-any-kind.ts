// Number(x) where the type of x says little: a number, a text of any make, nothing, a BigInt, an object that converts itself, a symbol.
const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    const value = work();
    text = Object.is(value, -0) ? "-0" : String(value);
  } catch (error) {
    text = "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
  lines.push(label + ": " + text);
}
const ofAny = (value: any): number => Number(value);
const ofUnknown = (value: unknown): number => Number(value);
const ofTextOrNull = (value: string | null): number => Number(value);
const ofTextOrUndefined = (value?: string): number => Number(value);
const ofTextOrNumber = (value: string | number): number => Number(value);
const sumOf = (values: unknown[]): number => {
  let sum = 0;
  for (const value of values) sum += Number(value);
  return sum;
};
const order: string[] = [];
const rope = (a: string, b: string) => a + b;
const values: [string, unknown][] = [
  ["an integer", 7],
  ["a negative zero", -0],
  ["a fraction", 1.5],
  ["what is no number", NaN],
  ["infinity", -Infinity],
  ["digits", "10"],
  ["digits put together", rope("12", "34".repeat(8))],
  ["part of a text", "abc123def".slice(3, 6)],
  ["an empty text", ""],
  ["blanks", " \t\n 42 \r\n"],
  ["a blank of another script", " 7﻿"],
  ["sixteen-bit digits", "１"],
  ["a sixteen-bit text with digits", "7 "],
  ["hexadecimal", "0x1f"],
  ["binary", "0b101"],
  ["octal", "0o17"],
  ["an exponent", "1e3"],
  ["a sign", "-5"],
  ["a signed zero", "-0"],
  ["a signed hexadecimal", "-0x1f"],
  ["Infinity", "Infinity"],
  ["infinity in small letters", "infinity"],
  ["a separator", "1_000"],
  ["a suffix", "12px"],
  ["a BigInt literal in a text", "12n"],
  ["a long text", "9".repeat(400)],
  ["null", null],
  ["undefined", undefined],
  ["true", true],
  ["false", false],
  ["a BigInt", 12n],
  ["a large BigInt", 2n ** 70n],
  ["a negative BigInt", -(2n ** 64n)],
  ["a symbol", Symbol.iterator],
  ["an empty object", {}],
  ["an empty array", []],
  ["an array of one", ["8"]],
  ["an array of two", [1, 2]],
  ["a date", new Date(5)],
  ["a wrapped number", new Number(9)],
  ["a wrapped text", new String("11")],
  ["an object with valueOf", { valueOf: () => (order.push("valueOf"), "13") }],
  ["an object with toString", { toString: () => (order.push("toString"), "14") }],
  ["an object with both", { valueOf: () => (order.push("valueOf of both"), {}), toString: () => (order.push("toString of both"), "15") }],
  ["an object that yields a BigInt", { valueOf: () => 16n }],
  ["an object that yields a symbol", { valueOf: () => Symbol.iterator }],
  ["an object with Symbol.toPrimitive", { [Symbol.toPrimitive]: (hint: string) => (order.push(hint), 17) }],
  ["an object that throws", { valueOf() { throw new RangeError("no number"); } }],
  ["an object without a prototype", Object.create(null)],
  ["a function", () => 1],
];
for (let turn = 0; turn < 3; turn++) {
  for (const [label, value] of values) {
    say(turn + " any " + label, () => ofAny(value));
    say(turn + " unknown " + label, () => ofUnknown(value));
    if (typeof value === "string" || value === null) say(turn + " text or null " + label, () => ofTextOrNull(value));
    if (typeof value === "string" || value === undefined) say(turn + " text or undefined " + label, () => ofTextOrUndefined(value));
    if (typeof value === "string" || typeof value === "number") say(turn + " text or number " + label, () => ofTextOrNumber(value));
  }
}
say("no argument", () => (Number as () => number)());
say("two arguments", () => (Number as (...values: unknown[]) => number)("5", (order.push("second"), "6")));
say("a sum", () => sumOf(["1", 2, null, true, "0x10", 3n, " 4 "]));
say("the order", () => order.join(" "));
console.log(lines.join("\n"));
