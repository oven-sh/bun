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

class Tools {
  total: (list: number[]) => number = total;
  sum = sum;
  readonly code = code;
  once: (f: Step) => number;
  static half = half;
  #hidden = half;

  constructor() {
    this.once = once;
  }

  viaPrivate(n: number): number {
    return this.#hidden(n);
  }

  run(list: number[], p: Point, s: string, f: Step, n: number): number {
    return this.total(list) + this.sum(p) + this.code(s) + this.once(f) + Tools.half(n) + this.#hidden(n);
  }
}

const literal = { total, sum, code, once, half, nested: { deep: { half } } };
const tools = new Tools();

honest("honest before");
warm();
console.log("honest through fields", tools.total([1, 2]), tools.sum({ x: 1, y: 2 }), tools.code("a"), tools.once(increment), Tools.half(3), tools.viaPrivate(3), tools.run([1], { x: 1, y: 1 }, "a", increment, 2), literal.total([1]), literal.nested.deep.half(5));
let rounds = 0;
for (let i = 0; i < 2000; i++) rounds += tools.total([i]) + tools.sum({ x: i, y: 0 }) + tools.code("a") + tools.once(increment) + Tools.half(i) + tools.viaPrivate(i) + literal.half(i);
console.log("2000 honest rounds through fields", rounds);

for (const text of lists) {
  attempt("field total " + text, () => tools.total(hidden(text)));
  attempt("literal total " + text, () => literal.total(hidden(text)));
  attempt("run with list " + text, () => tools.run(hidden(text), { x: 1, y: 1 }, "a", increment, 2));
}
for (const text of points) {
  attempt("field sum " + text, () => tools.sum(hidden(text)));
  attempt("literal sum " + text, () => literal.sum(hidden(text)));
  attempt("run with point " + text, () => tools.run([1], hidden(text), "a", increment, 2));
}
for (const text of strings) {
  attempt("field code " + text, () => tools.code(hidden(text)));
  attempt("run with string " + text, () => tools.run([1], { x: 1, y: 1 }, hidden(text), increment, 2));
}
for (const text of steps) {
  attempt("field once " + text, () => tools.once(hidden(text)));
  attempt("run with step " + text, () => tools.run([1], { x: 1, y: 1 }, "a", hidden(text), 2));
}
for (const text of numbers) {
  attempt("static half " + text, () => Tools.half(hidden(text)));
  attempt("private half " + text, () => tools.viaPrivate(hidden(text)));
  attempt("nested half " + text, () => literal.nested.deep.half(hidden(text)));
  attempt("run with number " + text, () => tools.run([1], { x: 1, y: 1 }, "a", increment, hidden(text)));
}

for (const text of ["list => 'replaced'", "null", "5", "{ call() {} }", "class {}", "new Proxy(function () {}, { apply(t, self, args) { note('apply'); return args.length; } })"]) {
  const changed = new Tools();
  changed.total = hidden(text);
  attempt("the field itself holds " + text, () => changed.total([1, 2]));
  attempt("  plus one", () => changed.total([1, 2]) + 1);
  attempt("  in run", () => changed.run([1], { x: 1, y: 1 }, "a", increment, 2));
  const changedLiteral = { ...literal };
  changedLiteral.half = hidden(text);
  attempt("the literal's member holds " + text, () => changedLiteral.half(4));
}

(Tools as any).half = hidden("n => 'static replaced'");
attempt("the static field was replaced", () => Tools.half(4));
attempt("  in run", () => tools.run([1], { x: 1, y: 1 }, "a", increment, 2));
Tools.half = half;

honest("honest after");
