function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

function add(a: number, b: number): number {
  return a + b;
}

function subtract(a: number, b: number): number {
  return a - b;
}

function multiply(a: number, b: number): number {
  return a * b;
}

function divide(a: number, b: number): number {
  return a / b;
}

function remainder(a: number, b: number): number {
  return a % b;
}

function power(a: number, b: number): number {
  return a ** b;
}

function less(a: number, b: number): boolean {
  return a < b;
}

function atLeast(a: number, b: number): boolean {
  return a >= b;
}

function same(a: number, b: number): boolean {
  return a === b;
}

function loose(a: number, b: number): boolean {
  return a == b;
}

function smaller(a: number, b: number): number {
  return Math.min(a, b);
}

function mixed(a: number, b: number): number {
  let result = 0;
  for (let i = 0; i < 2; i++) result += a * i - b;
  return result;
}

function honest(label: string): void {
  const x = 7;
  const y = 2.5;
  console.log(label, add(1, 2), add(x, y), subtract(x, y), multiply(x, y), divide(x, 2), remainder(x, 2), power(x, 2), less(x, y), atLeast(x, y), same(x, x), loose(x, y), smaller(x, y), mixed(x, y));
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

const texts = [
  "3",
  "'3'",
  "''",
  "' 3 '",
  "'three'",
  "-0",
  "NaN",
  "Infinity",
  "2147483647",
  "-2147483648",
  "9007199254740993",
  "0.1",
  "3n",
  "null",
  "undefined",
  "true",
  "[]",
  "[3]",
  "[3, 4]",
  "{}",
  "new Number(3)",
  "new Date(3)",
  "{ valueOf() { note('valueOf'); return 3; } }",
  "{ toString() { note('toString'); return '3'; } }",
  "{ valueOf() { note('valueOf'); return {}; }, toString() { note('toString'); return '3'; } }",
  "{ [Symbol.toPrimitive](hint) { note(hint); return 3; } }",
  "{ [Symbol.toPrimitive](hint) { note(hint); return 3n; } }",
  "{ valueOf() { throw new RangeError('no'); } }",
  "Symbol()",
  "function () {}",
];

honest("honest before");
let warm = 0;
for (let i = 1; i <= 2000; i++) warm += add(i, 1) + subtract(i, 1) + multiply(i, 2) + divide(i, 2) + remainder(i, 3) + power(i, 1) + smaller(i, 5) + mixed(i, 1) + (less(i, 5) ? 1 : 0) + (atLeast(i, 5) ? 1 : 0) + (same(i, 5) ? 1 : 0) + (loose(i, 5) ? 1 : 0);
console.log("2000 honest rounds", warm);

for (const text of texts) {
  attempt("less " + text, () => less(hidden(text), 4));
  attempt("atLeast " + text, () => atLeast(4, hidden(text)));
  attempt("same " + text, () => same(hidden(text), 3));
  attempt("loose " + text, () => loose(hidden(text), 3));
  attempt("smaller " + text, () => smaller(hidden(text), 0));
}

honest("honest after");
