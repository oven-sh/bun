const report = value => console.log(typeof value === "string" ? value : String(value));
// Generated: classes that share a prototype object, a kind of cell or a row of classes, each asked about the values of all.
const show = (value) => value === true ? "1" : value === false ? "0" : String(value);
function attempt(act) { try { return act(); } catch (error) { return "T"; } }
function maybe(name, make, values) { try { values.push([name, make()]); } catch (error) { values.push([name + ", which cannot be made: " + error.name, undefined]); } }

function isMap(x) { return x instanceof Map; }
function countMap(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Map) count++; } return count; }
function isWeakMap(x) { return x instanceof WeakMap; }
function countWeakMap(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof WeakMap) count++; } return count; }
function isSet(x) { return x instanceof Set; }
function countSet(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Set) count++; } return count; }
function isWeakSet(x) { return x instanceof WeakSet; }
function countWeakSet(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof WeakSet) count++; } return count; }
function isWeakRef(x) { return x instanceof WeakRef; }
function countWeakRef(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof WeakRef) count++; } return count; }
function isArray(x) { return x instanceof Array; }
function countArray(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Array) count++; } return count; }
function isIterator(x) { return x instanceof Iterator; }
function countIterator(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Iterator) count++; } return count; }
function isObject(x) { return x instanceof Object; }
function countObject(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Object) count++; } return count; }
const tests = [["Map", isMap, countMap], ["WeakMap", isWeakMap, countWeakMap], ["Set", isSet, countSet], ["WeakSet", isWeakSet, countWeakSet], ["WeakRef", isWeakRef, countWeakRef], ["Array", isArray, countArray], ["Iterator", isIterator, countIterator], ["Object", isObject, countObject]];
const values = [];
maybe("created below Map.prototype", () => Object.create(Map.prototype), values);
maybe("Map.prototype", () => Map.prototype, values);
maybe("Map", () => Map, values);
maybe("new Map", () => new Map(), values);
maybe("new of a class below Map", () => new (class extends Map {})(), values);
maybe("new Map without its prototype", () => Object.setPrototypeOf(new Map(), null), values);
maybe("new Map below WeakMap.prototype", () => Object.setPrototypeOf(new Map(), WeakMap.prototype), values);
maybe("a proxy of new Map", () => new Proxy(new Map(), {}), values);
maybe("Map made for WeakMap as new.target", () => Reflect.construct(Map, [], WeakMap), values);
maybe("created below WeakMap.prototype", () => Object.create(WeakMap.prototype), values);
maybe("WeakMap.prototype", () => WeakMap.prototype, values);
maybe("WeakMap", () => WeakMap, values);
maybe("new WeakMap", () => new WeakMap(), values);
maybe("new of a class below WeakMap", () => new (class extends WeakMap {})(), values);
maybe("new WeakMap without its prototype", () => Object.setPrototypeOf(new WeakMap(), null), values);
maybe("new WeakMap below Set.prototype", () => Object.setPrototypeOf(new WeakMap(), Set.prototype), values);
maybe("a proxy of new WeakMap", () => new Proxy(new WeakMap(), {}), values);
maybe("WeakMap made for Set as new.target", () => Reflect.construct(WeakMap, [], Set), values);
maybe("created below Set.prototype", () => Object.create(Set.prototype), values);
maybe("Set.prototype", () => Set.prototype, values);
maybe("Set", () => Set, values);
maybe("new Set", () => new Set(), values);
maybe("new of a class below Set", () => new (class extends Set {})(), values);
maybe("new Set without its prototype", () => Object.setPrototypeOf(new Set(), null), values);
maybe("new Set below WeakSet.prototype", () => Object.setPrototypeOf(new Set(), WeakSet.prototype), values);
maybe("a proxy of new Set", () => new Proxy(new Set(), {}), values);
maybe("Set made for WeakSet as new.target", () => Reflect.construct(Set, [], WeakSet), values);
maybe("created below WeakSet.prototype", () => Object.create(WeakSet.prototype), values);
maybe("WeakSet.prototype", () => WeakSet.prototype, values);
maybe("WeakSet", () => WeakSet, values);
maybe("new WeakSet", () => new WeakSet(), values);
maybe("new of a class below WeakSet", () => new (class extends WeakSet {})(), values);
maybe("new WeakSet without its prototype", () => Object.setPrototypeOf(new WeakSet(), null), values);
maybe("new WeakSet below WeakRef.prototype", () => Object.setPrototypeOf(new WeakSet(), WeakRef.prototype), values);
maybe("a proxy of new WeakSet", () => new Proxy(new WeakSet(), {}), values);
maybe("WeakSet made for WeakRef as new.target", () => Reflect.construct(WeakSet, [], WeakRef), values);
maybe("created below WeakRef.prototype", () => Object.create(WeakRef.prototype), values);
maybe("WeakRef.prototype", () => WeakRef.prototype, values);
maybe("WeakRef", () => WeakRef, values);
maybe("new WeakRef", () => new WeakRef({}), values);
maybe("new of a class below WeakRef", () => new (class extends WeakRef {})({}), values);
maybe("new WeakRef without its prototype", () => Object.setPrototypeOf(new WeakRef({}), null), values);
maybe("new WeakRef below Array.prototype", () => Object.setPrototypeOf(new WeakRef({}), Array.prototype), values);
maybe("a proxy of new WeakRef", () => new Proxy(new WeakRef({}), {}), values);
maybe("WeakRef made for Array as new.target", () => Reflect.construct(WeakRef, [{}], Array), values);
maybe("created below Array.prototype", () => Object.create(Array.prototype), values);
maybe("Array.prototype", () => Array.prototype, values);
maybe("Array", () => Array, values);
maybe("new Array", () => new Array(), values);
maybe("new of a class below Array", () => new (class extends Array {})(), values);
maybe("new Array without its prototype", () => Object.setPrototypeOf(new Array(), null), values);
maybe("new Array below Iterator.prototype", () => Object.setPrototypeOf(new Array(), Iterator.prototype), values);
maybe("a proxy of new Array", () => new Proxy(new Array(), {}), values);
maybe("Array made for Iterator as new.target", () => Reflect.construct(Array, [], Iterator), values);
maybe("created below Iterator.prototype", () => Object.create(Iterator.prototype), values);
maybe("Iterator.prototype", () => Iterator.prototype, values);
maybe("Iterator", () => Iterator, values);
maybe("created below Object.prototype", () => Object.create(Object.prototype), values);
maybe("Object.prototype", () => Object.prototype, values);
maybe("Object", () => Object, values);
maybe("new Object", () => new Object(), values);
maybe("new of a class below Object", () => new (class extends Object {})(), values);
maybe("new Object without its prototype", () => Object.setPrototypeOf(new Object(), null), values);
maybe("new Object below Map.prototype", () => Object.setPrototypeOf(new Object(), Map.prototype), values);
maybe("a proxy of new Object", () => new Proxy(new Object(), {}), values);
maybe("Object made for Map as new.target", () => Reflect.construct(Object, [], Map), values);
maybe("new Map().keys()", () => (new Map().keys()), values);
maybe("new Map().entries()", () => (new Map().entries()), values);
maybe("new Set().values()", () => (new Set().values()), values);
maybe("[].values()", () => ([].values()), values);
maybe("[][Symbol.iterator]()", () => ([][Symbol.iterator]()), values);
maybe(`""[Symbol.iterator]()`, () => (""[Symbol.iterator]()), values);
maybe(`"a".matchAll(/a/g)`, () => ("a".matchAll(/a/g)), values);
maybe("[].values().map((x) => x)", () => ([].values().map((x) => x)), values);
maybe("Iterator.from({ next() { return { done: true }; } })", () => (Iterator.from({ next() { return { done: true }; } })), values);
maybe("(function* () {})()", () => ((function* () {})()), values);
maybe("(async function* () {})()", () => ((async function* () {})()), values);
maybe("(function () { return arguments; })()", () => ((function () { return arguments; })()), values);
maybe("Array(2)", () => (Array(2)), values);
maybe("Array.of(1)", () => (Array.of(1)), values);
maybe("new Map().set(1, 2)", () => (new Map().set(1, 2)), values);
maybe("Object.groupBy([], () => 1)", () => (Object.groupBy([], () => 1)), values);
maybe("Map.groupBy([], () => 1)", () => (Map.groupBy([], () => 1)), values);
maybe(`/a/.exec("a")`, () => (/a/.exec("a")), values);
maybe(`\`a\`.split("")`, () => (`a`.split("")), values);
maybe("new Set().union(new Set())", () => (new Set().union(new Set())), values);
for (const [name, value] of values) {
  let answers = "";
  for (const [, is, count] of tests) answers += show(attempt(() => is(value))) + show(attempt(() => count(value)));
  report(answers + " " + name);
}
const ordinary = Function.prototype[Symbol.hasInstance];
report("Map: " + (Map[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Map, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Map, value))) + show(attempt(() => Map[Symbol.hasInstance](value)))).join(""));
report("WeakMap: " + (WeakMap[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(WeakMap, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(WeakMap, value))) + show(attempt(() => WeakMap[Symbol.hasInstance](value)))).join(""));
report("Set: " + (Set[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Set, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Set, value))) + show(attempt(() => Set[Symbol.hasInstance](value)))).join(""));
report("WeakSet: " + (WeakSet[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(WeakSet, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(WeakSet, value))) + show(attempt(() => WeakSet[Symbol.hasInstance](value)))).join(""));
report("WeakRef: " + (WeakRef[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(WeakRef, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(WeakRef, value))) + show(attempt(() => WeakRef[Symbol.hasInstance](value)))).join(""));
report("Array: " + (Array[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Array, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Array, value))) + show(attempt(() => Array[Symbol.hasInstance](value)))).join(""));
report("Iterator: " + (Iterator[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Iterator, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Iterator, value))) + show(attempt(() => Iterator[Symbol.hasInstance](value)))).join(""));
report("Object: " + (Object[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Object, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Object, value))) + show(attempt(() => Object[Symbol.hasInstance](value)))).join(""));
process.exit(0);
