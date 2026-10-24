function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  return typeof value;
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function first(list: number[]): number {
  return list[0];
}

function size(list: number[]): number {
  return list.length;
}

function fromLiteral(): number {
  return total([1, 2, 3]) + first([4]) + size([5, 6]);
}

function fromParameter(values: number[]): number {
  return total(values) + first(values) + size(values);
}

function fromSpread(values: number[]): number {
  return total([...values, 4]);
}

function fromMap(values: number[]): number {
  return total(values.map(value => value * 2));
}

class Basket {
  prices: number[] = [5, 6.5];
  sum(): number {
    return total(this.prices) + first(this.prices) + size(this.prices);
  }
}

function honest(label: string): void {
  console.log(label, fromLiteral(), fromParameter([4, 5]), fromSpread([1]), fromMap([1, 2]), new Basket().sum());
}

const hidden = (text: string): any => (0, eval)("(" + text + ")");

const texts = [
  "[1, 2, 3]",
  "[1.5, -0]",
  "[-0]",
  "['1', '2']",
  "[1, '2', 3]",
  "[1, , 3]",
  "[, ,]",
  "[1, undefined, 3]",
  "[1, null, 3]",
  "[1n, 2n]",
  "[{ valueOf() { return 7; } }, 1]",
  "[[1], [2]]",
  "[true, false]",
  "[2147483647, 1]",
  "[1e308, 1e308]",
  "[0.1, 0.2]",
  "{ length: 2, 0: 10, 1: 20 }",
  "{ length: 3, 0: 123, 1: 456 }",
  "{ length: '2', 0: 1, 1: 2 }",
  "{ length: -1 }",
  "{ length: 1.5, 0: 1, 1: 2 }",
  "{}",
  "'123'",
  "''",
  "new String('45')",
  "new Uint8Array([250, 10])",
  "new Float64Array([0.5, -0])",
  "new BigInt64Array(2)",
  "Buffer.from([1, 2])",
  "(function () { return arguments; })(1, 2, 3)",
  "new Proxy([1, 2], {})",
  "new Proxy([1, 2], { get(t, k, r) { return k === 'length' ? 1 : Reflect.get(t, k, r); } })",
  "Object.freeze([1, 2])",
  "Object.setPrototypeOf([1, 2], null)",
  "Object.setPrototypeOf([1, , 3], { 1: 100 })",
  "Object.defineProperty([1, 2, 3], 1, { get() { return 50; } })",
  "Object.assign([1, 2], { extra: 9 })",
  "new (class extends Array {})(1, 2, 3)",
  "new Array(3)",
  "Array(2).fill(1.5)",
  "Array.from({ length: 3 })",
  "Array.from({ length: 3 }, (_, i) => i)",
  "new Set([1, 2])",
  "new Map([[0, 1]])",
  "function (a, b) {}",
  "null",
  "undefined",
  "0",
  "NaN",
  "true",
  "Symbol.iterator",
];

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += total([i, 1]) + first([i]) + size([i]);
console.log("2000 honest calls", warm);

for (const text of texts) {
  const impostor: any = hidden(text);
  attempt("total " + text, () => total(impostor));
  attempt("first " + text, () => first(impostor));
  attempt("size " + text, () => size(impostor));
}

honest("honest after");

console.log("bytes made in plain sight", Buffer.from("he").length);
