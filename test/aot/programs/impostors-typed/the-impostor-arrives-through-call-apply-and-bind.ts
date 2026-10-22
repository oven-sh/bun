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

function routes(name: string, f: any, texts: string[]): void {
  for (const text of texts) {
    attempt(name + ".call " + text, () => f.call(undefined, hidden(text)));
    attempt(name + ".apply " + text, () => f.apply(undefined, [hidden(text)]));
    attempt(name + ".apply with an array-like " + text, () => f.apply(undefined, { length: 1, 0: hidden(text) }));
    attempt(name + ".bind with the argument " + text, () => f.bind(undefined, hidden(text))());
    attempt(name + ".bind without " + text, () => f.bind(undefined)(hidden(text)));
    attempt(name + " Reflect.apply " + text, () => Reflect.apply(f, undefined, [hidden(text)]));
    attempt(name + " call.call " + text, () => Function.prototype.call.call(f, undefined, hidden(text)));
    attempt(name + " apply.call " + text, () => Function.prototype.apply.call(f, undefined, [hidden(text)]));
  }
}

honest("honest before");
warm();
console.log("honest routes", total.call(undefined, [1, 2]), total.apply(undefined, [[3, 4]]), total.bind(undefined, [5])(), sum.call(null, { x: 1, y: 1 }), code.apply(null, ["b"]), once.bind(null)(increment), half.call(undefined, 9));

for (const text of lists) {
  const impostor: any = hidden(text);
  attempt("typed total.call " + text, () => total.call(undefined, impostor));
  attempt("typed total.apply " + text, () => total.apply(undefined, [impostor]));
  attempt("typed total.bind " + text, () => total.bind(undefined, impostor)());
}

routes("total", total, lists);
routes("sum", sum, points);
routes("code", code, strings);
routes("once", once, steps);
routes("half", half, numbers);

attempt("apply with no list", () => (total as any).apply(undefined));
attempt("apply with null", () => (total as any).apply(undefined, null));
attempt("apply with a number", () => (total as any).apply(undefined, 5));
attempt("call with nothing", () => (total as any).call());
attempt("half.call with nothing", () => (half as any).call());
attempt("half.apply with a string", () => (half as any).apply(undefined, hidden("new String('8')")));

honest("honest after");
