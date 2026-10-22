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

attempt("the very first call of total", () => total(hidden("'12'")));
attempt("the very first call of sum", () => sum(hidden("{ x: '1', y: 2 }")));
attempt("the very first call of code", () => code(hidden("['a']")));
attempt("the very first call of once", () => once(hidden("n => 'text'")));
attempt("the very first call of half", () => half(hidden("'3'")));

honest("honest after the first impostors");

for (const text of lists) attempt("total " + text, () => total(hidden(text)));
for (const text of points) attempt("sum " + text, () => sum(hidden(text)));
for (const text of strings) attempt("code " + text, () => code(hidden(text)));
for (const text of steps) attempt("once " + text, () => once(hidden(text)));
for (const text of numbers) attempt("half " + text, () => half(hidden(text)));

honest("honest after all impostors");
warm();

function alternate<T>(name: string, f: (value: T) => number, good: T, texts: string[]): void {
  for (const text of texts) {
    attempt(name + " honest", () => f(good));
    attempt(name + " impostor " + text, () => f(hidden(text)));
    attempt(name + " honest again", () => f(good));
  }
}

alternate("total", total, [1, 2], lists);
alternate("sum", sum, { x: 1, y: 2 }, points);
alternate("code", code, "abc", strings);
alternate("once", once, increment, steps);
alternate("half", half, 3, numbers);

function oneSite(values: number[][]): string {
  const results: string[] = [];
  for (const value of values) {
    try {
      results.push(show(total(value)));
    } catch (error) {
      results.push(error instanceof Error ? error.constructor.name : typeof error);
    }
  }
  return results.join(" ");
}

const row: any[] = [];
for (let i = 0; i < 50; i++) row.push([i, 1]);
for (const text of lists) row.push(hidden(text), [1, 1]);
console.log("one site", oneSite(row));

honest("honest at the end");
