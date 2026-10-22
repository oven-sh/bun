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

function lookUp(m: Map<string, number>, key: string): number {
  return (m.get(key) ?? 0) + 1;
}

function sizeOf(m: Map<string, number>): number {
  return m.size;
}

function sumValues(m: Map<string, number>): number {
  let sum = 0;
  for (const [, value] of m) sum += value;
  return sum;
}

function remember(m: Map<string, number>, key: string, value: number): number {
  m.set(key, value);
  return m.size;
}

function holds(s: Set<number>, n: number): boolean {
  return s.has(n);
}

function sumSet(s: Set<number>): number {
  let sum = 0;
  s.forEach(value => {
    sum += value;
  });
  return sum;
}

function addTo(s: Set<number>, n: number): number {
  return s.add(n).size;
}

function weak(w: WeakMap<object, number>, key: object): number {
  return (w.get(key) ?? 0) + 1;
}

function honest(label: string): void {
  const m = new Map([["a", 1], ["b", 2]]);
  const s = new Set([1, 2]);
  const key = {};
  console.log(label, lookUp(m, "a"), lookUp(m, "z"), sizeOf(m), sumValues(m), remember(m, "c", 3), holds(s, 1), sumSet(s), addTo(s, 3), weak(new WeakMap([[key, 1]]), key));
}

honest("honest before");
const busy = new Map<string, number>([["a", 1]]);
const busySet = new Set<number>();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += lookUp(busy, "a") + sizeOf(busy) + sumValues(busy) + remember(busy, "a", i) + (holds(busySet, i) ? 1 : 0) + addTo(busySet, i & 7);
console.log("2000 honest rounds", warm);

const maps = [
  "new Map([['a', 1]])",
  "new Map([['a', '1']])",
  "new Map([['a', null]])",
  "new Map([['a', 1n]])",
  "new Map([[{ toString() { return 'a'; } }, 1]])",
  "new (class extends Map { get(k) { note('own-get'); return 41; } set(k, v) { note('own-set'); return this; } get size() { return 'big'; } })([['a', 1]])",
  "new (class extends Map { *[Symbol.iterator]() { yield ['x', 100]; } })([['a', 1]])",
  "Object.assign(new Map([['a', 1]]), { get() { return 'own'; } })",
  "Object.setPrototypeOf(new Map([['a', 1]]), null)",
  "new Proxy(new Map([['a', 1]]), {})",
  "{ get(k) { return 5; }, set() {}, size: 9, [Symbol.iterator]: function* () { yield ['k', 6]; } }",
  "{ a: 1 }",
  "new WeakMap()",
  "new Set(['a'])",
  "[['a', 1]]",
  "Object.freeze(new Map([['a', 1]]))",
  "null",
  "5",
];

for (const text of maps) {
  attempt("lookUp " + text, () => lookUp(hidden(text), "a"));
  attempt("sizeOf " + text, () => sizeOf(hidden(text)));
  attempt("sumValues " + text, () => sumValues(hidden(text)));
  attempt("remember " + text, () => remember(hidden(text), "b", 2));
}

for (const text of ["'a'", "5", "null", "{ toString() { return 'a'; } }", "new String('a')", "NaN", "-0"]) {
  attempt("lookUp with the key " + text, () => lookUp(new Map<any, number>([["a", 1], [5, 2], [null, 3], [NaN, 4], [0, 5]]), hidden(text)));
  attempt("remember under the key " + text, () => {
    const m = new Map<string, number>([["a", 1]]);
    remember(m, hidden(text), 2);
    return [...m.keys()].map(k => typeof k + ":" + show(k));
  });
}

for (const text of ["2", "'2'", "undefined", "-0", "{}"]) {
  attempt("remember the value " + text, () => {
    const m = new Map<string, number>([["a", 1]]);
    remember(m, "b", hidden(text));
    return [sumValues(m), lookUp(m, "b")];
  });
}

const sets = [
  "new Set([1, 2])",
  "new Set(['1', 2])",
  "new Set([NaN, -0])",
  "new (class extends Set { has() { return 'yes'; } add() { note('own-add'); return { size: 'none' }; } forEach(f) { f('each'); } })([1])",
  "new Proxy(new Set([1]), {})",
  "{ has() { return 1; }, add() { return this; }, size: 3, forEach(f) { f(7); f('8'); } }",
  "[1, 2]",
  "new Map([[1, 1]])",
  "new WeakSet()",
  "null",
];

for (const text of sets) {
  attempt("holds " + text, () => holds(hidden(text), 1));
  attempt("sumSet " + text, () => sumSet(hidden(text)));
  attempt("addTo " + text, () => addTo(hidden(text), 3));
}
for (const text of ["'1'", "NaN", "-0", "1n", "null"]) attempt("holds the value " + text, () => holds(new Set<any>([1, NaN, 0, null]), hidden(text)));

for (const text of ["{}", "'key'", "5", "null", "Symbol('s')", "Symbol.for('s')"]) attempt("weak with the key " + text, () => weak(new WeakMap(), hidden(text)));
attempt("weak is a Map", () => weak(hidden("new Map([['k', '1']])"), hidden("'k'")));

honest("honest after");
