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

const callWith = new Function("f", "v", "return f(v);");
const callWithText = new Function("f", "text", "return f(eval('(' + text + ')'));");
const callTwice = new Function("f", "a", "b", "return [f(a), f(b)];");

function seenByDirectEval(text: string): unknown {
  return eval("total(" + text + ")");
}

function pointSeenByDirectEval(text: string): unknown {
  const local = (p: Point): number => p.x * p.y;
  return eval("local(" + text + ") + sum(" + text + ")");
}

function parameterRewrittenByDirectEval(list: number[], text: string): number {
  eval("list = " + text);
  let result = 0;
  for (let i = 0; i < list.length; i++) result += list[i];
  return result;
}

function localRewrittenByDirectEval(text: string): number {
  let n: number = 4;
  let s: string = "four";
  eval(text);
  return n / 2 + s.length;
}

honest("honest before");
warm();
console.log("honest through the same doors", callWith(total, [1, 2]), callWith(sum, { x: 1, y: 2 }), callWith(code, "a"), callWith(once, increment), callWith(half, 4), seenByDirectEval("[1, 2]"), pointSeenByDirectEval("{ x: 2, y: 3 }"), parameterRewrittenByDirectEval([1], "[2, 3]"), localRewrittenByDirectEval("n = 6"));

const table: [string, Function, string[]][] = [
  ["total", total, lists],
  ["sum", sum, points],
  ["code", code, strings],
  ["once", once, steps],
  ["half", half, numbers],
];

for (const [name, f, texts] of table) {
  (globalThis as any)["shared_" + name] = f;
  for (const text of texts) {
    attempt("new Function " + name + " " + text, () => callWith(f, hidden(text)));
    attempt("new Function makes it " + name + " " + text, () => callWithText(f, text));
    attempt("indirect eval " + name + " " + text, () => (0, eval)("shared_" + name + "(" + text + ")"));
    attempt("honest and impostor " + name + " " + text, () => callTwice(f, hidden(texts[0]), hidden(text)));
  }
}

for (const text of lists) {
  attempt("direct eval total " + text, () => seenByDirectEval(text));
  attempt("direct eval rewrites the parameter " + text, () => parameterRewrittenByDirectEval([1, 2], text));
}
for (const text of points) attempt("direct eval sum " + text, () => pointSeenByDirectEval(text));
for (const text of ["n = '6'", "n = 6n", "n = null", "s = 5", "s = null", "s = ['a', 'b']", "n = { valueOf() { note('valueOf'); return 10; } }", "var n = 'shadow'", "n = -0; s = ''"]) {
  attempt("direct eval rewrites a local: " + text, () => localRewrittenByDirectEval(text));
}

honest("honest after");
