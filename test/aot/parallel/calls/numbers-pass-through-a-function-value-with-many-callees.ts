// One place calls a function value that may be any of several functions. Each takes and returns numbers: fractions, integers, minus zero, no number at all, undefined.
declare const process: { argv: string[] };
const seed: number = process.argv.length > 99 ? 7 : 3;
const out: string[] = [];
function show(name: string, value: unknown): void {
  out.push(name + " " + (Object.is(value, -0) ? "-0" : String(value)) + " " + typeof value);
}

function apply(operation: (value: number) => number, value: number): number { return operation(value) + 1; }
function applyTwo(operation: (first: number, second: number) => number, first: number, second: number): number { return operation(first, second) * 2; }
function applyOptional(operation: (value: number) => number | undefined, value: number): number { return operation(value) ?? -1; }
function applyMany(operation: (value: number) => number, value: number): number { return operation(value) - 1; }

const double = (value: number): number => value * 2;
const half = (value: number): number => value / 2;
const negate = (value: number): number => -value;
const square = (value: number): number => value * value;
const floor = (value: number): number => Math.floor(value);
const bits = (value: number): number => value | 0;
function adder(by: number): (value: number) => number { return value => value + by; }

const sum = (first: number, second: number): number => first + second;
const difference = (first: number, second: number): number => first - second;
const product = (first: number, second: number): number => Math.imul(first, second);
const quotient = (first: number, second: number): number => first / second;
const larger = (first: number, second: number): number => Math.max(first, second);
const onlyFirst = (first: number): number => first;

const some = (value: number): number | undefined => (value > 3 ? value : undefined);
const none = (_value: number): number | undefined => undefined;
const zero = (_value: number): number | undefined => -0;
const nan = (value: number): number | undefined => value / 0 - value / 0;
const big = (value: number): number | undefined => 4294967296 + value;

const one: ((value: number) => number)[] = [double, half, negate, square, floor, bits];
const two: ((first: number, second: number) => number)[] = [sum, difference, product, quotient, larger, onlyFirst];
const optional: ((value: number) => number | undefined)[] = [some, none, zero, nan, big];
const many: ((value: number) => number)[] = [double, half, negate, square, floor, bits, adder(1.5), adder(2), Math.sqrt, Math.abs, value => value % 3];

for (let turn = 0; turn < 3; turn++) {
  for (const value of [seed + turn, -seed - 0.5, 0, -0, 2147483647, 1e300, NaN]) {
    for (const operation of one) show("one " + operation.name, apply(operation, value));
    for (const operation of two) show("two " + operation.name, applyTwo(operation, value, seed));
    for (const operation of optional) show("optional " + operation.name, applyOptional(operation, value));
    for (const operation of many) show("many " + operation.name, applyMany(operation, value));
  }
}
console.log(out.join("\n"));
