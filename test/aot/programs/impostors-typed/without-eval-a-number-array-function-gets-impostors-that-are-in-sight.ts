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

function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function iterated(list: number[]): number {
  let sum = 0;
  for (const value of list) sum += value;
  return sum;
}

function grown(list: number[]): number {
  return list.push(123);
}

function doubled(list: number[]): number[] {
  return list.map(value => value * 2);
}

function first(list: number[]): number {
  return list[0];
}

class Stack extends Array<number> {
  push(): number {
    return 42;
  }
  map(): any {
    return "mapped";
  }
  *[Symbol.iterator](): ArrayIterator<number> {
    yield 1000;
  }
}

function honest(label: string): void {
  const kept = [3, 4.5];
  console.log(label, total([1, 2]), total(kept), iterated([1, 2]), iterated(kept), grown([1]), show(doubled(kept)), first(kept));
}

const makers: [string, () => any][] = [
  ["numbers", () => [1, 2, 3]],
  ["strings", () => ["1", "2"]],
  ["a string among numbers", () => [1, "2", 3]],
  ["a hole", () => [1, , 3]],
  ["negative zero", () => [-0]],
  ["null and undefined", () => [null, undefined]],
  ["bigints", () => [1n, 2n]],
  ["objects with valueOf", () => [{ valueOf: () => (log.push("valueOf"), 7) }, 1]],
  ["an array-like", () => ({ length: 2, 0: 10, 1: 20 })],
  ["an array-like that is too short", () => ({ length: 3, 0: 123, 1: 456 })],
  ["an array-like with methods", () => ({ length: 1, 0: 5, push: () => "pushed", map: () => "mapped", [Symbol.iterator]: function* () { yield 6; } })],
  ["a string", () => "123"],
  ["a String object", () => new String("45")],
  ["bytes", () => new Uint8Array([250, 10])],
  ["doubles", () => new Float64Array([0.5, -0])],
  ["a subclass", () => Stack.from([1, 2, 3])],
  ["a proxy", () => new Proxy([1, 2], {})],
  ["a proxy that shortens", () => new Proxy([1, 2], { get: (t, k, r) => (k === "length" ? 1 : Reflect.get(t, k, r)) })],
  ["frozen", () => Object.freeze([1, 2])],
  ["without a prototype", () => Object.setPrototypeOf([1, 2], null)],
  ["an inherited element", () => Object.setPrototypeOf([1, , 3], { 1: 100, push: Array.prototype.push })],
  ["an element that is a getter", () => Object.defineProperty([1, 2, 3], 1, { get: () => (log.push("getter"), 50) })],
  ["an own push", () => Object.assign([1, 2], { push: () => "own push" })],
  ["new Array(3)", () => new Array(3)],
  ["Array.from a length", () => Array.from({ length: 3 })],
  ["a set", () => new Set([1, 2])],
  ["a map", () => new Map([[0, 1]])],
  ["a generator", () => (function* () { yield 1; yield 2; })()],
  ["arguments", () => (function (..._: number[]) { return arguments; })(1, 2, 3)],
  ["a function", () => (a: number, b: number) => a + b],
  ["null", () => null],
  ["undefined", () => undefined],
  ["a number", () => 5],
  ["parsed numbers", () => JSON.parse("[1,2,3]")],
  ["parsed strings", () => JSON.parse('["1","2"]')],
  ["a parsed array-like", () => JSON.parse('{"length":2,"0":1,"1":2}')],
];

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += total([i, 1]) + iterated([i, 1]) + grown([i]) + doubled([i]).length + first([i]);
console.log("2000 honest rounds", warm);

for (const [name, make] of makers) {
  attempt("total " + name, () => total(make()));
  attempt("iterated " + name, () => iterated(make()));
  attempt("grown " + name, () => grown(make()));
  attempt("doubled " + name, () => doubled(make()));
  attempt("first " + name, () => first(make()));
}

attempt("written at the call: a string", () => total("12" as any));
attempt("written at the call: an array-like", () => total({ length: 2, 0: 1, 1: 2 } as any));
attempt("written at the call: strings", () => total(["1", "2"] as any));
attempt("written at the call: a double cast", () => total(new Set([1]) as unknown as number[]));
attempt("written at the call: null", () => total(null as any));

honest("honest after");
