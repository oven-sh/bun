function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
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

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

interface Point {
  x: number;
  y: number;
}

function isPoint(value: any): value is Point {
  return true;
}

function isNumber(value: unknown): value is number {
  return value !== null;
}

function isList(value: unknown): value is number[] {
  return typeof value === "object" || typeof value === "string";
}

function isText(value: unknown): value is string {
  return typeof value !== "number";
}

function isStep(value: unknown): value is (n: number) => number {
  return value !== undefined;
}

function assertPoint(value: unknown): asserts value is Point {}

function assertNumber(value: unknown): asserts value is number {
  if (value === undefined) throw new RangeError("undefined");
}

function assertTruthy(value: unknown): asserts value {}

class Shape {
  sides = 4;
  isSquare(): this is Square {
    return true;
  }
}

class Square extends Shape {
  edge = 2;
  area(): number {
    return this.edge * this.edge;
  }
}

function sum(p: Point): number {
  return p.x + p.y;
}

function half(n: number): number {
  return n / 2;
}

function guardedSum(value: unknown): number | string {
  return isPoint(value) ? sum(value) : "not a point";
}

function guardedInline(value: unknown): number | string {
  if (isPoint(value)) return value.x * value.y;
  return "not a point";
}

function guardedHalf(value: unknown): number | string {
  return isNumber(value) ? half(value) + value : "not a number";
}

function guardedTotal(value: unknown): number | string {
  if (!isList(value)) return "not a list";
  let sum = 0;
  for (let i = 0; i < value.length; i++) sum += value[i];
  return sum;
}

function guardedCode(value: unknown): number | string {
  return isText(value) ? value.charCodeAt(0) : "not a text";
}

function guardedCall(value: unknown): number | string {
  return isStep(value) ? value(1) + 1 : "not a function";
}

function assertedSum(value: unknown): number {
  assertPoint(value);
  return sum(value) + value.x;
}

function assertedHalf(value: unknown): number {
  assertNumber(value);
  return half(value) + value;
}

function assertedTruthy(value: number | null | undefined): number {
  assertTruthy(value);
  return value + 1;
}

function honest(label: string): void {
  console.log(label, guardedSum({ x: 1, y: 2 }), guardedInline({ x: 2, y: 3 }), guardedHalf(4), guardedTotal([1, 2]), guardedCode("a"), guardedCall((n: number) => n), assertedSum({ x: 1, y: 2 }), assertedHalf(4), assertedTruthy(1));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += Number(guardedSum({ x: i, y: 1 })) + Number(guardedHalf(i)) + Number(guardedTotal([i])) + Number(guardedCode("a")) + assertedSum({ x: i, y: 1 }) + assertedHalf(i);
console.log("2000 honest rounds", warm);

const texts = ["{ x: 1, y: 2 }", "{ x: '1', y: 2 }", "{ x: 1 }", "{ get x() { note('get-x'); return 1; }, y: 2 }", "[1, 2]", "['1', 2]", "[1, , 2]", "'12'", "''", "5", "'5'", "5n", "-0", "null", "undefined", "true", "n => n + '!'", "class {}", "new Set([1])", "{ length: 2, 0: 1, 1: 2 }", "{ charCodeAt() { return 'own'; } }", "Symbol()"];

for (const text of texts) {
  attempt("guardedSum " + text, () => guardedSum(hidden(text)));
  attempt("guardedInline " + text, () => guardedInline(hidden(text)));
  attempt("guardedHalf " + text, () => guardedHalf(hidden(text)));
  attempt("guardedTotal " + text, () => guardedTotal(hidden(text)));
  attempt("guardedCode " + text, () => guardedCode(hidden(text)));
  attempt("guardedCall " + text, () => guardedCall(hidden(text)));
  attempt("assertedSum " + text, () => assertedSum(hidden(text)));
  attempt("assertedHalf " + text, () => assertedHalf(hidden(text)));
  attempt("assertedTruthy " + text, () => assertedTruthy(hidden(text)));
}

attempt("this is Square", () => {
  const shape = new Shape();
  return shape.isSquare() ? shape.area() : "no";
});
attempt("this is Square: a field", () => {
  const shape = new Shape();
  return shape.isSquare() ? shape.edge + 1 : "no";
});
attempt("filter with a lying guard", () => {
  const mixed: unknown[] = [1, "2", null, 3n];
  const numbers: number[] = mixed.filter(isNumber);
  return numbers.map(n => (typeof n === "bigint" ? "bigint" : n + 1));
});
attempt("find with a lying guard", () => {
  const mixed: unknown[] = ["8", 1];
  const n: number | undefined = mixed.find(isNumber);
  return n === undefined ? "none" : half(n);
});
attempt("every with a lying guard", () => {
  const mixed: unknown[] = ["8", [4]];
  return mixed.every(isNumber) ? mixed.map(half) : "no";
});

honest("honest after");
