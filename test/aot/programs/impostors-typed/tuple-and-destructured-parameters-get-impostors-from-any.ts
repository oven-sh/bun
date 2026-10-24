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

function pairSum([a, b]: [number, number]): number {
  return a + b;
}

function pairByIndex(pair: [number, number]): number {
  return pair[0] - pair[1];
}

function mixedPair(pair: [string, number]): number {
  return pair[0].length + pair[1];
}

function headAndRest([head, ...rest]: number[]): number {
  return head * 10 + rest.length;
}

function unpack({ x, y }: Point): number {
  return x + y;
}

function unpackWithDefaults({ x = 10, y = 20 }: Partial<Point>): number {
  return x + y;
}

function unpackNested({ at: { x }, list: [first] }: { at: Point; list: number[] }): number {
  return x + first;
}

function unpackRest({ x, ...others }: Point & { z?: number }): string {
  return x + ":" + Object.keys(others).join();
}

function renamed({ x: left, y: right }: Point): number {
  return left / right;
}

function honest(label: string): void {
  console.log(label, pairSum([1, 2]), pairByIndex([5, 2]), mixedPair(["ab", 1]), headAndRest([1, 2, 3]), unpack({ x: 1, y: 2 }), unpackWithDefaults({ x: 1 }), unpackNested({ at: { x: 1, y: 2 }, list: [3] }), unpackRest({ x: 1, y: 2, z: 3 }), renamed({ x: 1, y: 2 }));
}

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += pairSum([i, 1]) + pairByIndex([i, 1]) + mixedPair(["a", i]) + headAndRest([i, 1]) + unpack({ x: i, y: 1 }) + unpackWithDefaults({ y: i }) + unpackNested({ at: { x: i, y: 0 }, list: [1] }) + renamed({ x: i, y: 1 });
console.log("2000 honest rounds", warm);

const pairs = [
  "[1, 2]",
  "['1', 2]",
  "[1]",
  "[]",
  "[1, 2, 3]",
  "[, 2]",
  "'12'",
  "'1'",
  "new Set([1, 2])",
  "new Map([[1, 2], [3, 4]])",
  "new Uint8Array([1, 2])",
  "{ 0: 1, 1: 2, length: 2 }",
  "(function* () { note('start'); try { yield 1; yield 2; yield 3; } finally { note('closed'); } })()",
  "{ [Symbol.iterator]() { let n = 0; return { next() { note('next'); return { done: n >= 5, value: ++n }; }, return() { note('return'); return {}; } }; } }",
  "{ [Symbol.iterator]() { return { next() { return { done: true }; } }; } }",
  "Object.assign([1, 2], { [Symbol.iterator]: function* () { yield 7; yield 8; } })",
  "(function () { return arguments; })(1, 2)",
  "null",
  "undefined",
  "5",
  "{}",
];

for (const text of pairs) {
  attempt("pairSum " + text, () => pairSum(hidden(text)));
  attempt("pairByIndex " + text, () => pairByIndex(hidden(text)));
  attempt("mixedPair " + text, () => mixedPair(hidden(text)));
  attempt("headAndRest " + text, () => headAndRest(hidden(text)));
}

const objects = [
  "{ x: 1, y: 2 }",
  "{ y: 2, x: 1 }",
  "{ x: '1', y: 2 }",
  "{ x: undefined, y: null }",
  "{ x: 1 }",
  "{}",
  "{ x: 1, y: 2, z: 3, w: 4 }",
  "{ get y() { note('get-y'); return 2; }, get x() { note('get-x'); return 1; } }",
  "Object.create({ x: 1, y: 2, z: 3 })",
  "new Proxy({ x: 1, y: 2 }, { get(t, k) { note('get:' + String(k)); return t[k]; }, ownKeys(t) { note('ownKeys'); return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t, k) { note('describe:' + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); } })",
  "[1, 2]",
  "'xy'",
  "5",
  "null",
  "undefined",
];

for (const text of objects) {
  attempt("unpack " + text, () => unpack(hidden(text)));
  attempt("unpackWithDefaults " + text, () => unpackWithDefaults(hidden(text)));
  attempt("unpackRest " + text, () => unpackRest(hidden(text)));
  attempt("renamed " + text, () => renamed(hidden(text)));
}

for (const text of ["{ at: { x: 1, y: 2 }, list: [3] }", "{ at: { x: '1' }, list: '3' }", "{ at: null, list: [3] }", "{ at: { x: 1 }, list: null }", "{ at: 5, list: new Set([3]) }", "{ list: [3] }", "{ get list() { note('get-list'); return [3]; }, get at() { note('get-at'); return { x: 1 }; } }"]) {
  attempt("unpackNested " + text, () => unpackNested(hidden(text)));
}

honest("honest after");
