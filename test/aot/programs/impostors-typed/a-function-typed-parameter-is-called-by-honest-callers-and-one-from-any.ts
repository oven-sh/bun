function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
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

type Step = (n: number) => number;

function once(f: Step): number {
  return f(1);
}

function twice(f: Step): number {
  return f(f(1));
}

function plusOne(f: Step): number {
  return f(1) + 1;
}

function eachOf(f: Step): number {
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += f(i);
  return sum;
}

function byCall(f: Step): number {
  return f.call(undefined, 1);
}

function byApply(f: Step): number {
  return f.apply(null, [1]);
}

function byBind(f: Step): number {
  return f.bind(null, 1)();
}

function mapped(f: Step): number[] {
  return [1, 2].map(f);
}

function named(f: Step): string {
  return f.name + "/" + f.length;
}

function increment(n: number): number {
  return n + 1;
}

class Counter {
  by = 5;
  add = (n: number): number => n + this.by;
}

function honest(label: string): void {
  const local = (n: number) => n * 3;
  const counter = new Counter();
  console.log(label, once(increment), once(local), once(n => n - 1), once(counter.add), twice(increment), plusOne(local), eachOf(increment), byCall(local), byApply(increment), byBind(local), show(mapped(increment)), named(increment));
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

const texts = [
  "n => n + 1",
  "function (n) { return this === undefined ? n : -n; }",
  "function (n) { 'use strict'; return this === undefined ? n : this === null ? n * 100 : -n; }",
  "n => String(n)",
  "n => n + 0.5",
  "n => -0",
  "n => undefined",
  "n => 1n",
  "n => ({ valueOf() { note('valueOf'); return 5; } })",
  "(a, b, c) => (b === undefined ? 0 : 10) + (c === undefined ? 0 : 100) + a",
  "function () { return arguments.length; }",
  "async n => n",
  "function* (n) { yield n; }",
  "class Made { constructor(n) { this.n = n; } }",
  "(n => n * 2).bind(null)",
  "(function (a, n) { return a + n; }).bind(null, 10)",
  "new Proxy(n => n + 1, {})",
  "new Proxy(n => n + 1, { apply(t, self, args) { note('apply:' + args.length); return 100; } })",
  "new Proxy(n => n + 1, { get(t, k, r) { note('get:' + String(k)); return Reflect.get(t, k, r); } })",
  "new Proxy(class {}, {})",
  "{ call() { return 'own call'; }, apply() { return 'own apply'; }, bind() { return () => 'own bind'; }, name: 'n', length: 'l' }",
  "Object.assign(n => n + 1, { call() { return 'own call'; }, apply() { return 'own apply'; }, bind() { return () => 'own bind'; } })",
  "Object.setPrototypeOf(n => n + 1, null)",
  "Object.defineProperty(n => n + 1, 'name', { value: 7 })",
  "Math.sqrt",
  "Math.max",
  "parseInt",
  "Number",
  "String",
  "Symbol",
  "BigInt",
  "Array",
  "Object",
  "Boolean",
  "isNaN",
  "eval",
  "JSON.stringify",
  "Function.prototype",
  "Function.prototype.call",
  "Array.prototype.push",
  "null",
  "undefined",
  "5",
  "'text'",
  "{}",
  "[]",
];

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += once(increment) + twice(increment) + plusOne(increment) + eachOf(increment) + byCall(increment) + byApply(increment) + byBind(increment) + mapped(increment).length;
console.log("2000 honest rounds", warm);

for (const text of texts) {
  attempt("once " + text, () => once(hidden(text)));
  attempt("twice " + text, () => twice(hidden(text)));
  attempt("plusOne " + text, () => plusOne(hidden(text)));
  attempt("eachOf " + text, () => eachOf(hidden(text)));
  attempt("mapped " + text, () => mapped(hidden(text)));
}

honest("honest after");
