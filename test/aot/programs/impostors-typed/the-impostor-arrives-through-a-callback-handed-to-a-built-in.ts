export {};

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

function compare(a: number, b: number): number {
  return a - b;
}

function add(a: number, b: number): number {
  return a + b;
}

function positive(n: number): boolean {
  return n > 0;
}

function bracket(match: string, offset: number): string {
  return "[" + match.length + "@" + (offset + 1) + "]";
}

function revive(key: string, value: number): number {
  return key.length + value;
}

honest("honest before");
warm();
console.log("honest callbacks", show([1, 2].map(half)), show([3, 1, 2].sort(compare)), [1, 2].reduce(add, 0), show([1, -1].filter(positive)), "a1b22".replace(/\d+/g, bracket), show([[1], [2, 3]].map(total)), show(["a", "bc"].map(code)), show([{ x: 1, y: 2 }].map(sum)), show([increment].map(once)));

const mixed = "[3, '3', 3n, -0, null, undefined, { valueOf() { note('valueOf'); return 4; } }, , 2.5]";

attempt("map half", () => hidden(mixed).slice(0, 2).map(half));
attempt("map half over all", () => hidden(mixed).map(half));
attempt("map half without the bigint", () => hidden(mixed).filter((v: any) => typeof v !== "bigint").map(half));
attempt("forEach half", () => hidden("['8']").forEach(half));
attempt("filter positive", () => hidden("[3, '3', '-3', null, [5], {}, NaN, 1n]").filter(positive));
attempt("find positive", () => hidden("['-3', '3']").find(positive));
attempt("some positive", () => hidden("[null, '1']").some(positive));
attempt("every positive", () => hidden("['1', true, [2]]").every(positive));
attempt("reduce add", () => hidden("[1, '2', 3]").reduce(add, 0));
attempt("reduce add without a start", () => hidden("['1', 2, 3]").reduce(add));
attempt("reduceRight add", () => hidden("[1, '2', 3]").reduceRight(add));
attempt("sort compare strings", () => hidden("['10', '9', '1']").sort(compare));
attempt("sort compare mixed", () => hidden("['10', 9, { valueOf() { return 1; } }]").sort(compare).map(Number));
attempt("sort compare bigints", () => hidden("[2n, 1n]").sort(compare));
attempt("sort compare bigint and number", () => hidden("[2n, 1]").sort(compare));
attempt("toSorted compare", () => hidden("['b', 'a']").toSorted(compare));
attempt("flatMap half", () => hidden("['4', 6]").flatMap(half));
attempt("Array.from half", () => Array.from(hidden("{ length: 2, 0: '4' }"), half));
attempt("Array.from a string half", () => Array.from(hidden("'48'"), half));
attempt("Array.from a set total", () => Array.from(hidden("new Set(['12', [1, 2], { length: 1, 0: 7 }])"), total));
attempt("map.call over an array-like", () => Array.prototype.map.call(hidden("{ length: 2, 0: '4', 1: 6 }"), half as any));
attempt("typed array map half", () => Array.from(hidden("new Float64Array([1, 3])").map(half)));
attempt("bigint array map half", () => hidden("new BigInt64Array(1)").map(half));
attempt("Map forEach", () => {
  const seen: unknown[] = [];
  hidden("new Map([['k', '8'], [2, 4]])").forEach((value: any) => seen.push(half(value)));
  hidden("new Map([['8', 'k']])").forEach(half);
  return seen;
});
attempt("Set forEach sum", () => {
  const seen: unknown[] = [];
  const wrapped = (p: Point): void => void seen.push(sum(p));
  hidden("new Set([{ x: 1, y: 2 }, { x: '1', y: 2 }, 'xy', 5])").forEach(wrapped);
  return seen;
});
attempt("map total", () => hidden("[[1, 2], '12', { length: 1, 0: 5 }, new Uint8Array([9]), [1, , 2]]").map(total));
attempt("map total with null", () => hidden("[[1], null]").map(total));
attempt("map sum", () => hidden("[{ x: 1, y: 2 }, { y: '2', x: 1 }, [1], 'xy', 5, { get x() { note('get-x'); return 1; }, y: 1 }]").map(sum));
attempt("map code", () => hidden("['abc', new String('b'), ['c'], { charCodeAt() { return -1; }, length: 0 }]").map(code));
attempt("map code with a number", () => hidden("['abc', 5]").map(code));
attempt("map once", () => hidden("[n => n, n => 'text', Math.sqrt, new Proxy(n => n, { apply() { return 7; } })]").map(once));
attempt("map once with a class", () => hidden("[class {}]").map(once));
attempt("replace with a pattern of its own", () => "abc".replace(hidden("{ [Symbol.replace](text, f) { return f(5, 'six'); } }"), bracket));
attempt("replace with groups", () => "a1".replace(hidden("/(a)(\\d)/"), bracket));
attempt("replaceAll", () => "aa".replaceAll(hidden("'a'"), bracket));
attempt("JSON.parse reviver", () => JSON.stringify(JSON.parse('{"a":1,"bb":"2","c":[3],"d":null}', revive)));
attempt("JSON.stringify replacer", () => JSON.stringify(hidden("{ a: 1, bb: '2' }"), revive));
attempt("Reflect.apply", () => Reflect.apply(half, undefined, hidden("['8']")));
attempt("a getter calls it", () => hidden("(f => ({ get v() { return f('8'); } }))")(half).v);
attempt("valueOf is it", () => +hidden("(f => ({ valueOf: f }))")(half));
attempt("toString is it", () => `${hidden("(f => ({ toString: f }))")(code)}`);
attempt("a proxy trap is it", () => hidden("(f => new Proxy({}, { get: f }))")(sum).anything);
attempt("an iterator's next is it", () => [...hidden("(f => ({ [Symbol.iterator]() { return { next: f }; } }))")(half)]);

const results: string[] = [];
await Promise.resolve(hidden("'8'")).then(half).then(v => results.push("then " + show(v)));
await Promise.resolve(hidden("'12'")).then(total).then(v => results.push("then total " + show(v)));
await Promise.resolve(hidden("null")).then(total).then(v => results.push("then total " + show(v)), e => results.push("then total rejected " + e.constructor.name));
await Promise.reject(hidden("{ x: '1', y: 2 }")).catch(sum).then(v => results.push("catch sum " + show(v)));
await hidden("({ then(resolve) { resolve('6'); } })").then(half);
await Promise.all(hidden("['4', 6, { then(r) { r('10'); } }]")).then(values => results.push("all " + show(values.map(half))));
await new Promise<void>(resolve => queueMicrotask(() => (results.push("microtask " + show(half(hidden("[8]")))), resolve())));
for (const line of results) console.log(line);

honest("honest after");
