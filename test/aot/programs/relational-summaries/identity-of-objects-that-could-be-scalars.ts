// An object of which only fields are read can be replaced by its fields, until somebody asks who it is: ===, Object.is, a switch, indexOf and includes, a key of a Map, a member of a Set, a key of a WeakMap. Two objects with equal fields are two; one object is one, whichever way it came.
interface Vec {
  x: number;
  y: number;
}
function make(x: number, y: number): Vec {
  return { x, y };
}
function same(a: Vec, b: Vec): boolean {
  return a === b;
}
function differ(a: Vec, b: Vec): boolean {
  return a !== b;
}
function sameByObjectIs(a: Vec, b: Vec): boolean {
  return Object.is(a, b);
}
function looselySame(a: Vec, b: Vec | null): boolean {
  return a == b;
}
function pick(a: Vec, b: Vec, first: boolean): Vec {
  return first ? a : b;
}
function identity<T>(value: T): T {
  return value;
}
function bySwitch(a: Vec, b: Vec, c: Vec): string {
  switch (a) {
    case b:
      return "is b";
    case c:
      return "is c";
    default:
      return "is neither";
  }
}
function positionIn(list: Vec[], v: Vec): string {
  return list.indexOf(v) + "/" + list.lastIndexOf(v) + "/" + list.includes(v) + "/" + list.findIndex(e => e === v);
}
function sumAndCompare(a: Vec, b: Vec): number {
  return a.x + a.y + b.x + b.y + (a === b ? 1000 : 0);
}
let line = "";
let total = 0;
for (let i = 0; i < 300; i++) {
  const a = make(i, 1);
  const b = make(i, 1);
  line = [
    same(a, a),
    same(a, b),
    same(make(1, 1), make(1, 1)),
    differ(a, a),
    differ(a, b),
    sameByObjectIs(a, a),
    sameByObjectIs(a, b),
    looselySame(a, a),
    looselySame(a, b),
    looselySame(a, null),
    pick(a, b, true) === a,
    pick(a, b, false) === a,
    pick(a, a, i % 2 === 0) === a,
    identity(a) === a,
    identity(identity(a)) === identity(a),
    identity(make(2, 2)) === identity(make(2, 2)),
    bySwitch(a, b, a),
    bySwitch(a, a, a),
    bySwitch(a, b, b),
    positionIn([b, a, b, a], a),
    positionIn([b, b], a),
    positionIn([make(i, 1)], make(i, 1)),
  ].join();
  total += sumAndCompare(a, b) + sumAndCompare(a, a) + sumAndCompare(make(1, 2), make(1, 2));
}
console.log(line);
console.log(total);

// Keys.
const counts = new Map<Vec, number>();
function countIn(v: Vec): number {
  const n = (counts.get(v) ?? 0) + 1;
  counts.set(v, n);
  return n;
}
const seen = new Set<Vec>();
function firstTime(v: Vec): boolean {
  if (seen.has(v)) return false;
  seen.add(v);
  return true;
}
const notes = new WeakMap<Vec, string>();
function note(v: Vec, text: string): string {
  const old = notes.get(v);
  notes.set(v, text);
  return old ?? "none";
}
let keys = "";
for (let i = 0; i < 100; i++) {
  const v = make(0, 0);
  keys = [countIn(v), countIn(v), countIn(make(0, 0)), firstTime(v), firstTime(v), firstTime(make(0, 0)), note(v, "first"), note(v, "second"), note(make(0, 0), "other")].join();
}
console.log(keys, counts.size, seen.size);

// The object goes out and comes back by another road.
class Registry {
  private items: Vec[] = [];
  add(v: Vec): number {
    return this.items.push(v) - 1;
  }
  get(i: number): Vec {
    return this.items[i];
  }
}
function roundTrip(registry: Registry, i: number): boolean {
  const v = make(i, i);
  const at = registry.add(v);
  v.x = -1;
  return registry.get(at) === v && registry.get(at).x === -1;
}
const registry = new Registry();
let trips = 0;
for (let i = 0; i < 200; i++) if (roundTrip(registry, i)) trips++;
console.log(trips);

// Fresh results compared with each other and with themselves.
function pairOf(i: number): [Vec, Vec] {
  const v = make(i, i);
  return [v, i % 2 ? v : make(i, i)];
}
let equalPairs = 0;
for (let i = 0; i < 200; i++) {
  const [p, q] = pairOf(i);
  if (p === q) equalPairs++;
  q.x++;
  if (p.x === q.x) equalPairs += 1000;
}
console.log(equalPairs);

// Closures have an identity too.
function makeReader(v: Vec): () => number {
  return () => v.x;
}
function sameFunction(f: () => number, g: () => number): boolean {
  return f === g;
}
let functions = "";
for (let i = 0; i < 100; i++) {
  const v = make(i, i);
  const f = makeReader(v);
  functions = [sameFunction(f, f), sameFunction(f, makeReader(v)), sameFunction(makeReader(v), makeReader(v)), [f].includes(f), new Set([f, f, makeReader(v)]).size].join();
}
console.log(functions);
