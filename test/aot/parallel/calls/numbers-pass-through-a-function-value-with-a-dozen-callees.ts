// Several places call a function value that may be any of a dozen functions. Each takes and returns numbers: fractions, integers, minus zero, no number at all, undefined.
// Some capture a variable, some were given a property or another name, some throw, some call the value again, some are called last.
declare const process: { argv: string[] };
const seed: number = process.argv.length > 99 ? 7 : 3;
const out: string[] = [];
function show(name: string, value: unknown): void {
  out.push(name + " " + (Object.is(value, -0) ? "-0" : String(value)) + " " + typeof value);
}

type Operation = (value: number) => number;
function apply(operation: Operation, value: number): number { return operation(value) + 1; }
function applyAgain(operation: Operation, value: number): number { return operation(operation(value)) - 1; }
function applyInteger(operation: Operation, value: number): number { return operation(value | 0) * 2; }
function applyTwo(operation: (first: number, second: number) => number, first: number, second: number): number { return operation(first, second) * 2; }
function applyLast(operation: (first: number, second: number) => number, first: number, second: number): number { return operation(first, second); }
function applyOptional(operation: (value: number) => number | undefined, value: number): number { return operation(value) ?? -1; }
function applyWithMore(operation: Operation, value: number): number { return (operation as (value: number, more: number) => number)(value, 99) + 0.5; }
function applyWithNone(operation: Operation): number { return (operation as () => number)(); }

const double: Operation = value => value * 2;
const half: Operation = value => value / 2;
const negate: Operation = value => -value;
const square: Operation = value => value * value;
const floor: Operation = value => Math.floor(value);
const bits: Operation = value => value | 0;
const next: Operation = value => value + 1;
const previous: Operation = value => value - 1;
const third: Operation = value => value / 3;
function cube(value: number): number { return value * value * value; }
function adder(by: number): Operation { return value => value + by; }
let calls = 0;
const counting: Operation = value => value + ++calls;
function down(value: number): number { return value > 2 && value < 9 ? apply(down, value - 1) : value; }
function refuses(value: number): number {
  if (value > 1e200) throw new RangeError("too large: " + value);
  return value;
}
function withDefault(value: number = 41): number { return value + 1; }

const sum = (first: number, second: number): number => first + second;
const difference = (first: number, second: number): number => first - second;
const product = (first: number, second: number): number => Math.imul(first, second);
const quotient = (first: number, second: number): number => first / second;
const larger = (first: number, second: number): number => Math.max(first, second);
const smaller = (first: number, second: number): number => Math.min(first, second);
const onlyFirst = (first: number): number => first;
const onlySecond = (_first: number, second: number): number => second;
const remainder = (first: number, second: number): number => first % second;
const power = (first: number, second: number): number => first ** (second & 3);

const some = (value: number): number | undefined => (value > 3 ? value : undefined);
const none = (_value: number): number | undefined => undefined;
const zero = (_value: number): number | undefined => -0;
const nan = (value: number): number | undefined => value / 0 - value / 0;
const big = (value: number): number | undefined => 4294967296 + value;
const small = (value: number): number | undefined => (value < 0 ? undefined : 1 / 3);
const whole = (value: number): number | undefined => value | 0;
const same = (value: number): number | undefined => value;
const odd = (value: number): number | undefined => (value & 1 ? value : undefined);

(square as Operation & { note?: string }).note = "has a property";
Object.defineProperty(third, "name", { value: "aThird" });

const one: Operation[] = [double, half, negate, square, floor, bits, next, previous, third, cube, adder(1.5), adder(2), counting, down, refuses, withDefault];
const two: ((first: number, second: number) => number)[] = [sum, difference, product, quotient, larger, smaller, onlyFirst, onlySecond, remainder, power];
const optional: ((value: number) => number | undefined)[] = [some, none, zero, nan, big, small, whole, same, odd];

// Each hop ends in a call of the next function, a million deep: no frame may stay behind.
function hop(operation: Operation, value: number): number { return operation(value); }
const hops: Operation[] = [];
for (let index = 0; index < 10; index++) hops.push(value => (value > 0 ? hop(hops[(value + index) % 10], value - 1) : value + index + 0.5));

class Scale {
  factor: number;
  run: Operation;
  constructor(factor: number, run: Operation) { this.factor = factor; this.run = run; }
  scaled(value: number): number { return this.run(value) * this.factor; }
}

function attempt(name: string, run: () => number): void {
  try {
    show(name, run());
  } catch (error) {
    const lines = String((error as Error).stack).split("\n").slice(0, 3).map(line => line.trim().replace(/\(.*$/, "").trim());
    out.push(name + " threw " + lines.join(" | "));
  }
}

for (let turn = 0; turn < 3; turn++) {
  for (const value of [seed + turn, -seed - 0.5, 0, -0, 2147483647, 1e300, NaN]) {
    for (const operation of one) {
      attempt("one " + operation.name, () => apply(operation, value));
      attempt("again " + operation.name, () => applyAgain(operation, value));
      attempt("integer " + operation.name, () => applyInteger(operation, value));
      attempt("more " + operation.name, () => applyWithMore(operation, value));
      attempt("scaled " + operation.name, () => new Scale(turn + 0.5, operation).scaled(value));
    }
    for (const operation of two) show("two " + operation.name, applyTwo(operation, value, seed));
    for (const operation of two) show("last " + operation.name, applyLast(operation, value, seed));
    for (const operation of optional) show("optional " + operation.name, applyOptional(operation, value));
  }
  for (const operation of one) attempt("none " + operation.name, () => applyWithNone(operation));
}
show("hops", hop(hops[seed], 1000000));
show("note", (square as Operation & { note?: string }).note);
show("calls", calls);
console.log(out.join("\n"));
