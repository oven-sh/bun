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

const halves: ((n: number) => number)[] = [half, n => n / 2, increment];
const sums: Array<(p: Point) => number> = [sum, p => p.x - p.y];
const pair: [(list: number[]) => number, (s: string) => number] = [total, code];
const byName = new Map<string, (n: number) => number>([
  ["half", half],
  ["increment", increment],
]);
const inSet = new Set<(list: number[]) => number>([total]);

function applyAll(fs: ((n: number) => number)[], n: number): number[] {
  const results: number[] = [];
  for (let i = 0; i < fs.length; i++) results.push(fs[i](n));
  return results;
}

function chain(fs: ((n: number) => number)[], n: number): number {
  for (const f of fs) n = f(n);
  return n;
}

honest("honest before");
warm();
console.log("honest through containers", halves[0](4), halves[1](4), sums[0]({ x: 1, y: 2 }), pair[0]([1, 2]), pair[1]("a"), byName.get("half")?.(4), show(applyAll(halves, 4)), chain(halves, 4), [...inSet][0]([5]));
let rounds = 0;
for (let i = 0; i < 2000; i++) rounds += halves[i % 3](i) + sums[i % 2]({ x: i, y: 1 }) + pair[0]([i]) + chain(halves, i);
console.log("2000 honest rounds through containers", rounds);

for (const text of numbers) {
  attempt("halves[0] " + text, () => halves[0](hidden(text)));
  attempt("halves[1] " + text, () => halves[1](hidden(text)));
  attempt("applyAll " + text, () => applyAll(halves, hidden(text)));
  attempt("chain " + text, () => chain(halves, hidden(text)));
  attempt("map entry " + text, () => byName.get("half")?.(hidden(text)));
}
for (const text of points) for (let i = 0; i < sums.length; i++) attempt("sums[" + i + "] " + text, () => sums[i](hidden(text)));
for (const text of lists) {
  attempt("pair[0] " + text, () => pair[0](hidden(text)));
  attempt("from the set " + text, () => [...inSet][0](hidden(text)));
}
for (const text of strings) attempt("pair[1] " + text, () => pair[1](hidden(text)));

for (const text of ["n => 'text'", "null", "undefined", "5", "class {}", "{ call() {} }", "new Proxy(n => n, { apply() { note('apply'); return -0; } })", "async n => n"]) {
  const changed = [...halves];
  changed[1] = hidden(text);
  attempt("an element is " + text, () => changed[1](4));
  attempt("  applyAll", () => applyAll(changed, 4));
  attempt("  chain", () => chain(changed, 4));
}

attempt("past the end", () => halves[3](4));
attempt("a hole", () => {
  const holey: ((n: number) => number)[] = [half];
  holey[2] = half;
  return applyAll(holey, 4);
});
attempt("the list of functions is an impostor: array-like", () => applyAll(hidden("{ length: 1, 0: n => n + 'x' }"), 4));
attempt("the list of functions is an impostor: set", () => chain(hidden("new Set([n => n + 1, n => n + 'x'])"), 4));
attempt("the list of functions is an impostor: string", () => applyAll(hidden("'ab'"), 4));

honest("honest after");
