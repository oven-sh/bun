// A handful of slots hold objects: literals typed by an interface with optional fields, instances of a class that implements it, literals without a
// type. A long history drawn by a generator of random numbers inside the program stores, removes, defines with attributes, freezes, replaces and
// copies them: Object.assign with one source or several, spread, rest, structuredClone, entries, descriptors, JSON. Now and then, and at the end,
// the program sums up what it sees: every own key in its order, names and symbols, with its value and its attributes.
import type { Random } from "./random";

const makers = [
  `(v: number): Row => ({ a: v })`,
  `(v: number): Row => ({ a: v, b: "b" + v })`,
  `(v: number): Row => ({ a: v, b: "b" + v, c: v + 0.5 })`,
  `(v: number): Row => ({ a: v, c: v, d: v % 2 === 0 })`,
  `(v: number): Row => ({ d: true, a: v })`,
  `(v: number): Row => ({ a: v, [tag]: v })`,
  `(v: number): Row => ({ a: v, b: undefined })`,
  `(v: number): Row => {\nconst made: Row = { a: v };\nif (v % 3) made.c = v;\nreturn made;\n}`,
  `(v: number): Row => new Item(v)`,
  `(v: number): Row => new Wide(v)`,
  `(v: number): Row => untyped({ a: v, z: 1 })`,
  `(v: number): Row => untyped({ z: 1, b: "u", a: v })`,
  `(v: number): Row => Object.assign(Object.create(parent), { a: v })`,
  `(v: number): Row => JSON.parse('{"a":' + v + ',"b":"parsed"}')`,
  `(v: number): Row => Object.defineProperty({ a: v } as Row, "c", { value: v, enumerable: false, configurable: true, writable: true })`,
  `(v: number): Row => Object.defineProperty({ a: v, b: "fixed" } as Row, "b", { configurable: false })`,
] as const;

// t is the target, s and u are sources, k a key, v a number; each may throw.
const operations = [
  `t.a = v;`,
  `t.a = v + 0.5;`,
  `t.b = "s" + v;`,
  `t.b = undefined;`,
  `t.c = v;`,
  `t.d = v % 2 === 0;`,
  `t[tag] = v;`,
  `delete t.b;`,
  `delete t.c;`,
  `delete t.d;`,
  `delete t[tag];`,
  `untyped(t)[k] = v;`,
  `delete untyped(t)[k];`,
  `Object.assign(t, s);`,
  `Object.assign(t, s);`,
  `Object.assign(t, s, u);`,
  `Object.assign(t, s, u, { c: v });`,
  `Object.assign(t, { a: v });`,
  `Object.assign(t, { b: "assigned", c: v });`,
  `Object.assign(t, { [tag]: v });`,
  `Object.assign(t, null, undefined, s);`,
  `Object.assign(t, v % 2 ? s : u);`,
  `Object.defineProperty(t, k, { value: v, enumerable: (v & 1) === 0, configurable: (v & 2) === 0, writable: (v & 4) === 0 });`,
  `Object.defineProperty(t, k, { value: v, enumerable: false, configurable: true, writable: true });`,
  `Object.defineProperty(t, k, { enumerable: false });`,
  `Object.defineProperty(t, k, { enumerable: true });`,
  `Object.defineProperty(t, k, { configurable: false });`,
  `Object.defineProperty(t, k, { writable: false });`,
  `Object.defineProperty(t, k, { get: () => v, enumerable: (v & 1) === 0, configurable: true });`,
  `Object.defineProperty(t, k, { get: () => v, set(value) {\nwrites++;\n}, enumerable: true, configurable: true });`,
  `Object.defineProperties(t, { a: { value: v, enumerable: (v & 1) === 0, configurable: true, writable: true }, c: { value: v, enumerable: true, configurable: true, writable: (v & 2) === 0 } });`,
  `Reflect.defineProperty(t, k, { value: v, enumerable: true, configurable: true, writable: true });`,
  `Reflect.set(t, k, v);`,
  `Reflect.deleteProperty(t, k);`,
  `Object.defineProperties(t, Object.getOwnPropertyDescriptors(s));`,
  `if (v % 61 === 0) Object.freeze(t);`,
  `if (v % 47 === 0) Object.seal(t);`,
  `if (v % 43 === 0) Object.preventExtensions(t);`,
  `if (v % 53 === 0) Object.setPrototypeOf(t, parent);`,
  `put({ ...s });`,
  `put({ ...s, c: v });`,
  `put({ a: v, ...untyped(s) });`,
  `put({ ...s, ...u });`,
  `put({ ...t, [tag]: v });`,
  `{\nconst { a, ...rest } = s;\nput({ a, ...rest });\n}`,
  `{\nconst { b, ...rest } = s;\nput(rest);\n}`,
  `{\nconst { [tag]: taken, ...rest } = s;\nput(rest);\n}`,
  `put(structuredClone(s));`,
  `put(untyped(Object.fromEntries(Object.entries(s))));`,
  `put(Object.create(Object.getPrototypeOf(s), Object.getOwnPropertyDescriptors(s)));`,
  `put(untyped(Object.defineProperties({}, Object.getOwnPropertyDescriptors(s))));`,
  `put(JSON.parse(JSON.stringify(s)));`,
  `put(Object.assign({}, s));`,
  `put(Object.assign({ a: v }, s, u));`,
  `put(Object.assign(new Item(v), s));`,
  `put(Object.assign(Object.create(parent), s));`,
  `put(make(v));`,
  `put(make(v));`,
  `put(make(v));`,
] as const;

export function generate(random: Random): string {
  const chosenMakers = random.sample(makers, random.between(2, 7));
  const chosen = random.sample(operations, random.between(8, 30));
  if (!chosen.some(operation => operation.startsWith("put(make"))) chosen.push(`put(make(v));`);
  const rounds = random.pick([2000, 6000, 6000, 20000]);
  const slots = random.between(3, 9);
  return `const tag: unique symbol = Symbol("tag");
const other = Symbol("other");
interface Row {
a: number;
b?: string;
c?: number;
d?: boolean;
[tag]?: number;
}
class Item implements Row {
a: number;
b?: string;
constructor(a: number) {
this.a = a;
}
}
class Wide implements Row {
a: number;
c: number = 1;
d: boolean = false;
constructor(a: number) {
this.a = a;
}
}
const parent = { inherited: 1 };
const untyped = (value: unknown): any => value;
const keys: (string | symbol)[] = ["a", "b", "c", "d", "z", "late", tag, other];
const makers: ((v: number) => Row)[] = [
${chosenMakers.join(",\n")},
];
let state = ${random.between(1, 1 << 30)};
function next(limit: number): number {
state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
return (state >>> 8) % limit;
}
const make = (v: number): Row => makers[v % makers.length](v);
const held: Row[] = [];
for (let index = 0; index < ${slots}; index++) held.push(make(index));
let writes = 0;
let failures = 0;
let sum = 7;
function mix(text: string): void {
for (let at = 0; at < text.length; at++) sum = (Math.imul(sum, 31) + text.charCodeAt(at)) | 0;
}
function describe(row: Row): string {
const parts: string[] = [];
const all = Object.getOwnPropertyDescriptors(row) as Record<string | symbol, PropertyDescriptor>;
for (const key of Reflect.ownKeys(row)) {
const own = all[key];
parts.push(String(key) + "=" + ("value" in own ? String(own.value) : "accessor " + String(own.get?.())) + (own.enumerable ? "e" : "-") + (own.configurable ? "c" : "-") + (own.writable ? "w" : "-"));
}
const walked: string[] = [];
for (const key in row) walked.push(key);
return parts.join() + "|" + Object.keys(row).join() + "|" + walked.join() + "|" + JSON.stringify(row) + "|" + (Object.isFrozen(row) ? "f" : "") + (Object.isSealed(row) ? "s" : "") + (Object.isExtensible(row) ? "x" : "");
}
function step(which: number, at: number, t: Row, s: Row, u: Row, k: string | symbol, v: number): void {
const put = (row: Row): void => {
held[at] = row;
};
switch (which) {
${chosen.map((operation, index) => `case ${index}: {\n${operation}\nbreak;\n}`).join("\n")}
}
}
for (let round = 1; round <= ${rounds}; round++) {
const at = next(held.length);
try {
step(next(${chosen.length}), at, held[at], held[next(held.length)], held[next(held.length)], keys[next(keys.length)], next(1000));
} catch {
failures++;
}
if (!Object.isExtensible(held[at]) && round % 5 === 0) held[at] = make(round);
mix(describe(held[at]));
if (round % ${rounds / 8} === 0) console.log("round", round, sum, failures, writes);
}
for (const row of held) console.log(describe(row));
`;
}
