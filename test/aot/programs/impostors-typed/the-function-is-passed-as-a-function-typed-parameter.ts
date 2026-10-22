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

type Step = (n: number) => number;

function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function sum(p: Point): number {
  return p.x + p.y;
}

function code(s: string): number {
  return s.charCodeAt(0) + s.length;
}

function once(f: Step): number {
  return f(1) + 1;
}

function half(n: number): number {
  return n / 2;
}

const lists = ["[1, 2]", "[1, '2']", "[1, , 3]", "[-0]", "{ length: 2, 0: 1, 1: 2 }", "'12'", "new Uint8Array([1, 2])", "new Proxy([1, 2], {})", "null"];
const points = ["{ x: 1, y: 2 }", "{ y: 2, x: 1 }", "{ x: '1', y: 2 }", "{ x: 1 }", "{ get x() { note('get-x'); return 1; }, y: 2 }", "[1, 2]", "5", "null"];
const strings = ["'abc'", "new String('abc')", "['a']", "{ charCodeAt() { return -1; }, length: 1 }", "65", "null"];
const steps = ["n => n + 1", "n => String(n)", "class {}", "new Proxy(n => n, { apply() { return 9; } })", "{ call() { return 1; } }", "null"];
const numbers = ["3", "'3'", "3n", "-0", "{ valueOf() { note('valueOf'); return 3; } }", "undefined"];

function increment(n: number): number {
  return n + 1;
}

function honest(label: string): void {
  const list = [1, 2.5];
  const point: Point = { x: 1, y: 2 };
  const word = "abc";
  console.log(label, total([1, 2]), total(list), sum({ x: 3, y: 4 }), sum(point), code("a"), code(word), once(increment), once(n => n * 2), half(3), half(list[0]));
}

function warm(): void {
  let result = 0;
  for (let i = 0; i < 2000; i++) result += total([i, 1]) + sum({ x: i, y: 1 }) + code("k") + once(increment) + half(i);
  console.log("2000 honest rounds", result);
}

function withList(f: (list: number[]) => number, list: number[]): number {
  return f(list) + 1;
}

function withPoint(f: (p: Point) => number, p: Point): number {
  return f(p) + 1;
}

function withString(f: (s: string) => number, s: string): number {
  return f(s) + 1;
}

function withNumber(f: Step, n: number): number {
  let result = 0;
  for (let i = 0; i < 2; i++) result += f(n);
  return result;
}

function generic<T>(f: (value: T) => number, value: T): number {
  return f(value) + 1;
}

function returned(which: number): Step {
  return which === 0 ? half : increment;
}

function composed(f: Step, g: Step): Step {
  return n => f(g(n));
}

honest("honest before");
warm();
console.log("honest handed on", withList(total, [1, 2]), withPoint(sum, { x: 1, y: 2 }), withString(code, "a"), withNumber(half, 3), generic(total, [1]), generic(half, 3), generic(code, "a"), returned(0)(3), composed(half, increment)(3));
let rounds = 0;
for (let i = 0; i < 2000; i++) rounds += withList(total, [i]) + withPoint(sum, { x: i, y: 1 }) + withString(code, "a") + withNumber(half, i) + generic(half, i) + returned(i & 1)(i) + composed(half, increment)(i);
console.log("2000 honest rounds handed on", rounds);

for (const text of lists) {
  attempt("withList " + text, () => withList(total, hidden(text)));
  attempt("generic total " + text, () => generic(total, hidden(text)));
}
for (const text of points) {
  attempt("withPoint " + text, () => withPoint(sum, hidden(text)));
  attempt("generic sum " + text, () => generic(sum, hidden(text)));
}
for (const text of strings) {
  attempt("withString " + text, () => withString(code, hidden(text)));
  attempt("generic code " + text, () => generic(code, hidden(text)));
}
for (const text of numbers) {
  attempt("withNumber " + text, () => withNumber(half, hidden(text)));
  attempt("generic half " + text, () => generic(half, hidden(text)));
  attempt("returned " + text, () => returned(0)(hidden(text)));
  attempt("composed " + text, () => composed(half, increment)(hidden(text)));
}
for (const text of steps) {
  attempt("withNumber gets the function " + text, () => withNumber(hidden(text), 3));
  attempt("generic gets the function " + text, () => generic(hidden(text), 3));
  attempt("composed outer " + text, () => composed(hidden(text), increment)(3));
  attempt("composed inner " + text, () => composed(half, hidden(text))(3));
  attempt("once handed on " + text, () => generic(once, hidden(text)));
}

attempt("the wrong function for the value", () => generic(hidden("f => f")(total), hidden("{ x: 1, y: 2 }")));
attempt("the functions crossed", () => withList(hidden("f => f")(code), [1, 2]));
attempt("the functions crossed the other way", () => withString(hidden("f => f")(total), "12"));

honest("honest after");
