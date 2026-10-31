// `{ ...source, name }`: the copy and the names that are written behind it, over every kind of source, with one name and with many, with names that the source has and names that it lacks.
// One call copies and defines.
// CALLS+ one operationAOTCopyObjectAndDefine
// CALLS+ two operationAOTCopyObjectAndDefine
// CALLS+ five operationAOTCopyObjectAndDefine
function one(source, name) { return { ...source, name }; }
function two(source, g, name) { return { ...source, name, g }; }
function five(source, a, b, c, d, e) { return { ...source, e, d, c, b, a }; }
function constants(source) { return { ...source, kind: "row", open: true, at: 0, ratio: 0.5, none: null, missing: undefined }; }
function twice(source, a, b) { return { ...source, a, b, a: b }; }
function late(source, a, make) { return { ...source, a, made: make(), last: a }; }
function lateThatThrows(source, a) { try { return { ...source, a, made: fail(), last: a }; } catch (error) { return error.message; } }
function fail() { throw new Error("thrown between two names"); }
function index(source, a) { return { ...source, a, 0: a, 1.5: a, b: a }; }
function proto(source, __proto__, a) { return { ...source, a, __proto__, b: a }; }
function protoSetter(source, a, above) { return { ...source, a, __proto__: above, b: a }; }
function builtInNames(source, a) { return { ...source, length: a, constructor: a, toString: a, then: a, prototype: a, valueOf: a }; }
function ownValue(source) { return { ...source, count: source ? source.count + 1 : 0 }; }
function secondSpread(source, other, a) { return { ...source, a, ...other, b: a }; }
function inLoop(source, n) { const made = []; for (let i = 0; i < n; i++) made.push({ ...source, i, n }); return made; }
function method(source, a) { return { ...source, a, get twice() { return this.a * 2; }, add(n) { return this.a + n; } }; }
function symbolKey(source, a) { return { ...source, a, [Symbol.toStringTag]: "Tagged", b: a }; }
function objectValue(source, value) { return { ...source, value, again: value }; }

let reads = 0;
class Point { constructor() { this.x = 1; this.y = 2; } get sum() { return this.x + this.y; } }
const wide = {}; for (let i = 0; i < 40; i++) wide["k" + i] = i;
const veryWide = {}; for (let i = 0; i < 300; i++) veryWide["k" + i] = i;
const deleted = JSON.parse('{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"h":8}'); delete deleted.h; delete deleted.g; delete deleted.b;
const hidden = Object.defineProperty({ shown: 1 }, "hidden", { value: 2, enumerable: false });
const readOnly = Object.defineProperty({ first: 1 }, "a", { value: 2, enumerable: true, writable: false, configurable: false });
const keyed = { [Symbol.for("key")]: 1, plain: 2 };
const sources = () => [
  JSON.parse('{"a":2,"b":"parsed"}'),
  JSON.parse('{"g":3,"name":"has both","z":1}'),
  JSON.parse('{"p":1,"q":2,"r":3,"s":4,"t":5}'),
  JSON.parse('{"p":1,"q":2,"r":3,"s":4,"t":5,"u":6}'),
  JSON.parse('{"p":1,"q":2,"r":3,"s":4,"t":5,"u":6,"v":7}'),
  JSON.parse('{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"h":7,"i":8,"j":9}'),
  JSON.parse('{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"h":7,"i":8,"j":9,"k":10}'),
  JSON.parse('{"__proto__":{"inherited":1},"own":1}'),
  JSON.parse('{"0":"zero","1":"one","a":"named"}'),
  JSON.parse('{}'),
  {},
  { a: 1, b: "x" },
  { count: 1, name: "literal" },
  { get g() { return ++reads; }, name: "getter" },
  { get a() { throw new Error("thrown by a getter"); } },
  Object.freeze({ g: 4, name: "frozen" }),
  Object.seal({ a: 4, name: "sealed" }),
  Object.preventExtensions({ a: 4, name: "closed" }),
  Object.assign(Object.create({ inherited: 1 }), { own: 1 }),
  Object.assign(Object.create(null), { bare: 1 }),
  new Point(),
  [1, 2],
  "text",
  7,
  true,
  null,
  undefined,
  Symbol.iterator,
  function named() {},
  new Map([[1, 2]]),
  new Proxy({ a: 1, z: 2 }, { ownKeys(target) { reads++; return Reflect.ownKeys(target).reverse(); } }),
  wide, veryWide, deleted, hidden, readOnly, keyed,
];
function show(made) {
  if (typeof made !== "object" || made === null) return String(made);
  const parts = [];
  for (const key of Reflect.ownKeys(made)) {
    const d = Object.getOwnPropertyDescriptor(made, key);
    const value = "value" in d ? (typeof d.value === "function" ? "function" : Object.is(d.value, -0) ? "-0" : typeof d.value === "object" && d.value !== null ? JSON.stringify(d.value) : String(d.value)) : "accessor";
    parts.push(String(key) + "=" + value + (d.writable === false ? "!w" : "") + (d.enumerable ? "" : "!e") + (d.configurable ? "" : "!c"));
  }
  const above = Object.getPrototypeOf(made);
  return parts.join(",") + " | " + (above === Object.prototype ? "Object" : above === null ? "null" : JSON.stringify(above)) + " " + Object.isExtensible(made);
}
function attempt(f) { try { return show(f()); } catch (error) { return "threw " + error.message; } }
const shared = { shared: true };
for (let round = 0; round < 4; round++) {
  const list = sources();
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    console.log(round, i, "one", attempt(() => one(s, "n" + round)));
    console.log(round, i, "two", attempt(() => two(s, round - 0.5, "m")), attempt(() => two(s, -0, "m")), attempt(() => two(s, NaN, "m")));
    console.log(round, i, "five", attempt(() => five(s, 1, "2", 3.5, null, shared)));
    console.log(round, i, "constants", attempt(() => constants(s)));
    console.log(round, i, "twice", attempt(() => twice(s, 1, 2)));
    console.log(round, i, "late", attempt(() => late(s, 1, () => round)), attempt(() => lateThatThrows(s, 1)));
    console.log(round, i, "index", attempt(() => index(s, round)));
    console.log(round, i, "proto", attempt(() => proto(s, shared, 1)), attempt(() => protoSetter(s, 1, shared)), attempt(() => protoSetter(s, 1, null)));
    console.log(round, i, "builtInNames", attempt(() => builtInNames(s, round)));
    console.log(round, i, "ownValue", attempt(() => ownValue(s)));
    console.log(round, i, "secondSpread", attempt(() => secondSpread(s, list[(i + 1) % list.length], round)));
    console.log(round, i, "inLoop", attempt(() => inLoop(s, 3)[2]));
    console.log(round, i, "method", attempt(() => method(s, 4)), attempt(() => method(s, 4).twice + method(s, 4).add(1)));
    console.log(round, i, "symbolKey", attempt(() => symbolKey(s, 1)));
    console.log(round, i, "objectValue", attempt(() => objectValue(s, shared)), attempt(() => objectValue(s, shared).value === shared));
  }
}
console.log(reads);

// The copy is its own object: a store to it reaches neither the source nor the next copy, and it takes further names.
const source = JSON.parse('{"a":1,"b":2,"c":3,"d":4,"e":5}');
const first = two(source, 1, "first"), second = two(source, 2, "second");
first.a = "changed"; first.more = 1; first.evenMore = 2; first.andMore = 3; delete first.b;
console.log(show(source), show(first), show(second));

// Many copies stay whole across collections.
let total = 0;
const kept = [];
for (let i = 0; i < 200000; i++) {
  const s = sources.length ? (i & 1 ? source : second) : null;
  const made = five(s, i, "text" + (i & 7), i + 0.5, { i }, [i]);
  if (!(i % 1000)) kept.push(made);
  total += made.a + made.c + made.d.i + made.e[0] + made.b.length;
  if (!(i % 50000) && typeof Bun !== "undefined") Bun.gc(true);
}
console.log(total, kept.length, show(kept[7]), show(kept[199]));

// A compiled object as the source, often enough that its copy finds no cell ready, with the names still to be read from the list.
class Pair { constructor(a, b) { this.a = a; this.b = b; } }
const literal = { a: 1, b: "x", c: 2.5 };
const pair = new Pair(1, 2);
let compiledTotal = 0;
for (let i = 0; i < 200000; i++) {
  compiledTotal += two(literal, i, "m").g + two(pair, i, "m").g + five(literal, i, 2, 3, 4, 5).a;
  if (!(i % 1000)) kept.push(one(pair, "n" + i));
}
console.log(compiledTotal, show(kept[kept.length - 1]));

// A source that becomes a prototype after its siblings were copied, and one that gets a getter, have other Structures from then on.
const shapes = [JSON.parse('{"x":1,"y":2}'), JSON.parse('{"x":3,"y":4}'), JSON.parse('{"x":5,"y":6}')];
for (let i = 0; i < 3; i++) console.log(show(two(shapes[i], i, "before")));
Object.create(shapes[0]);
Object.defineProperty(shapes[1], "got", { get() { return ++reads; }, enumerable: true });
Object.freeze(shapes[2]);
for (let i = 0; i < 3; i++) console.log(show(two(shapes[i], i, "after")));

// More Structures than the table of copies has room for, and lists of names of many lengths. A name that the copy overwrites stays where the source has it.
let lengths = 0;
for (let i = 0; i < 3000; i++) {
  const text = "{" + Array.from({ length: 1 + (i % 12) }, (_, k) => '"s' + (i % 700) + "_" + k + '":' + k).join() + "}";
  const made = i & 1 ? two(JSON.parse(text), i, "m") : five(JSON.parse(text), 1, 2, 3, 4, i);
  lengths += Object.keys(made).length;
  if (!(i % 500)) console.log(show(made));
}
console.log(lengths);
const overwritten = two(JSON.parse('{"name":"first","g":1,"z":2}'), 9, "second");
console.log(show(overwritten), overwritten.name, overwritten.g);
overwritten.g = 10; console.log(overwritten.g);
