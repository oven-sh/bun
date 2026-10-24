// Object.defineProperty of a name that an object with a layout does not have yet: every combination of value, get and set with the three flags absent, true and false, written as a literal at the call.
// On literals and instances of classes, with and without properties added earlier, frozen, sealed and not extensible; under a new name, a symbol, an index, the name of a field, of an empty field and of a method.
// Each definition is made three times on new objects, since the second one finds what the first one left behind. Afterwards: the descriptors, the keys, for..in, JSON, typed reads, a store and a delete.
type Define = (object: object, key: PropertyKey) => unknown;
type Way = [string, Define];

let stored: unknown = "nothing";
function getter(): number {
  return 7;
}
function setter(value: unknown): void {
  stored = value;
}
function yes(): boolean {
  return stored !== "never";
}
const notCallable: any = 1;

const literals: Way[] = [
  ["nothing", (object, key) => Object.defineProperty(object, key, {})],
  ["configurable", (object, key) => Object.defineProperty(object, key, { configurable: true })],
  ["!configurable", (object, key) => Object.defineProperty(object, key, { configurable: false })],
  ["enumerable", (object, key) => Object.defineProperty(object, key, { enumerable: true })],
  ["enumerable,configurable", (object, key) => Object.defineProperty(object, key, { enumerable: true, configurable: true })],
  ["enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { enumerable: true, configurable: false })],
  ["!enumerable", (object, key) => Object.defineProperty(object, key, { enumerable: false })],
  ["!enumerable,configurable", (object, key) => Object.defineProperty(object, key, { enumerable: false, configurable: true })],
  ["!enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { enumerable: false, configurable: false })],
  ["writable", (object, key) => Object.defineProperty(object, key, { writable: true })],
  ["writable,configurable", (object, key) => Object.defineProperty(object, key, { writable: true, configurable: true })],
  ["writable,!configurable", (object, key) => Object.defineProperty(object, key, { writable: true, configurable: false })],
  ["writable,enumerable", (object, key) => Object.defineProperty(object, key, { writable: true, enumerable: true })],
  ["writable,enumerable,configurable", (object, key) => Object.defineProperty(object, key, { writable: true, enumerable: true, configurable: true })],
  ["writable,enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { writable: true, enumerable: true, configurable: false })],
  ["writable,!enumerable", (object, key) => Object.defineProperty(object, key, { writable: true, enumerable: false })],
  ["writable,!enumerable,configurable", (object, key) => Object.defineProperty(object, key, { writable: true, enumerable: false, configurable: true })],
  ["writable,!enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { writable: true, enumerable: false, configurable: false })],
  ["!writable", (object, key) => Object.defineProperty(object, key, { writable: false })],
  ["!writable,configurable", (object, key) => Object.defineProperty(object, key, { writable: false, configurable: true })],
  ["!writable,!configurable", (object, key) => Object.defineProperty(object, key, { writable: false, configurable: false })],
  ["!writable,enumerable", (object, key) => Object.defineProperty(object, key, { writable: false, enumerable: true })],
  ["!writable,enumerable,configurable", (object, key) => Object.defineProperty(object, key, { writable: false, enumerable: true, configurable: true })],
  ["!writable,enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { writable: false, enumerable: true, configurable: false })],
  ["!writable,!enumerable", (object, key) => Object.defineProperty(object, key, { writable: false, enumerable: false })],
  ["!writable,!enumerable,configurable", (object, key) => Object.defineProperty(object, key, { writable: false, enumerable: false, configurable: true })],
  ["!writable,!enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { writable: false, enumerable: false, configurable: false })],
  ["value", (object, key) => Object.defineProperty(object, key, { value: 1 })],
  ["value,configurable", (object, key) => Object.defineProperty(object, key, { value: 1, configurable: true })],
  ["value,!configurable", (object, key) => Object.defineProperty(object, key, { value: 1, configurable: false })],
  ["value,enumerable", (object, key) => Object.defineProperty(object, key, { value: 1, enumerable: true })],
  ["value,enumerable,configurable", (object, key) => Object.defineProperty(object, key, { value: 1, enumerable: true, configurable: true })],
  ["value,enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { value: 1, enumerable: true, configurable: false })],
  ["value,!enumerable", (object, key) => Object.defineProperty(object, key, { value: 1, enumerable: false })],
  ["value,!enumerable,configurable", (object, key) => Object.defineProperty(object, key, { value: 1, enumerable: false, configurable: true })],
  ["value,!enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { value: 1, enumerable: false, configurable: false })],
  ["value,writable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: true })],
  ["value,writable,configurable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, configurable: true })],
  ["value,writable,!configurable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, configurable: false })],
  ["value,writable,enumerable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, enumerable: true })],
  ["value,writable,enumerable,configurable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, enumerable: true, configurable: true })],
  ["value,writable,enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, enumerable: true, configurable: false })],
  ["value,writable,!enumerable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, enumerable: false })],
  ["value,writable,!enumerable,configurable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, enumerable: false, configurable: true })],
  ["value,writable,!enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, enumerable: false, configurable: false })],
  ["value,!writable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: false })],
  ["value,!writable,configurable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: false, configurable: true })],
  ["value,!writable,!configurable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: false, configurable: false })],
  ["value,!writable,enumerable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: false, enumerable: true })],
  ["value,!writable,enumerable,configurable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: false, enumerable: true, configurable: true })],
  ["value,!writable,enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: false, enumerable: true, configurable: false })],
  ["value,!writable,!enumerable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: false, enumerable: false })],
  ["value,!writable,!enumerable,configurable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: false, enumerable: false, configurable: true })],
  ["value,!writable,!enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: false, enumerable: false, configurable: false })],
  ["get", (object, key) => Object.defineProperty(object, key, { get: getter })],
  ["get,configurable", (object, key) => Object.defineProperty(object, key, { get: getter, configurable: true })],
  ["get,!configurable", (object, key) => Object.defineProperty(object, key, { get: getter, configurable: false })],
  ["get,enumerable", (object, key) => Object.defineProperty(object, key, { get: getter, enumerable: true })],
  ["get,enumerable,configurable", (object, key) => Object.defineProperty(object, key, { get: getter, enumerable: true, configurable: true })],
  ["get,enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { get: getter, enumerable: true, configurable: false })],
  ["get,!enumerable", (object, key) => Object.defineProperty(object, key, { get: getter, enumerable: false })],
  ["get,!enumerable,configurable", (object, key) => Object.defineProperty(object, key, { get: getter, enumerable: false, configurable: true })],
  ["get,!enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { get: getter, enumerable: false, configurable: false })],
  ["set", (object, key) => Object.defineProperty(object, key, { set: setter })],
  ["set,configurable", (object, key) => Object.defineProperty(object, key, { set: setter, configurable: true })],
  ["set,!configurable", (object, key) => Object.defineProperty(object, key, { set: setter, configurable: false })],
  ["set,enumerable", (object, key) => Object.defineProperty(object, key, { set: setter, enumerable: true })],
  ["set,enumerable,configurable", (object, key) => Object.defineProperty(object, key, { set: setter, enumerable: true, configurable: true })],
  ["set,enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { set: setter, enumerable: true, configurable: false })],
  ["set,!enumerable", (object, key) => Object.defineProperty(object, key, { set: setter, enumerable: false })],
  ["set,!enumerable,configurable", (object, key) => Object.defineProperty(object, key, { set: setter, enumerable: false, configurable: true })],
  ["set,!enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { set: setter, enumerable: false, configurable: false })],
  ["get,set", (object, key) => Object.defineProperty(object, key, { get: getter, set: setter })],
  ["get,set,configurable", (object, key) => Object.defineProperty(object, key, { get: getter, set: setter, configurable: true })],
  ["get,set,!configurable", (object, key) => Object.defineProperty(object, key, { get: getter, set: setter, configurable: false })],
  ["get,set,enumerable", (object, key) => Object.defineProperty(object, key, { get: getter, set: setter, enumerable: true })],
  ["get,set,enumerable,configurable", (object, key) => Object.defineProperty(object, key, { get: getter, set: setter, enumerable: true, configurable: true })],
  ["get,set,enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { get: getter, set: setter, enumerable: true, configurable: false })],
  ["get,set,!enumerable", (object, key) => Object.defineProperty(object, key, { get: getter, set: setter, enumerable: false })],
  ["get,set,!enumerable,configurable", (object, key) => Object.defineProperty(object, key, { get: getter, set: setter, enumerable: false, configurable: true })],
  ["get,set,!enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { get: getter, set: setter, enumerable: false, configurable: false })],
];

const otherWays: Way[] = [
  ["value=undefined", (object, key) => Object.defineProperty(object, key, { value: undefined, enumerable: true })],
  ["get=undefined", (object, key) => Object.defineProperty(object, key, { get: undefined, enumerable: true })],
  ["set=undefined", (object, key) => Object.defineProperty(object, key, { set: undefined, enumerable: true })],
  ["get=undefined,set=undefined", (object, key) => Object.defineProperty(object, key, { get: undefined, set: undefined })],
  ["get,set=undefined", (object, key) => Object.defineProperty(object, key, { get: getter, set: undefined, configurable: true })],
  ["get is not callable", (object, key) => Object.defineProperty(object, key, { get: notCallable })],
  ["set is not callable", (object, key) => Object.defineProperty(object, key, { set: notCallable })],
  ["value,get", (object, key) => Object.defineProperty(object, key, { value: 1, get: getter })],
  ["value,set", (object, key) => Object.defineProperty(object, key, { value: 1, set: setter })],
  ["writable,get", (object, key) => Object.defineProperty(object, key, { writable: true, get: getter })],
  ["!writable,get,set", (object, key) => Object.defineProperty(object, key, { writable: false, get: getter, set: setter })],
  ["methods in the literal", (object, key) => Object.defineProperty(object, key, { get() { return 7; }, set(value: unknown) { stored = value; }, enumerable: true, configurable: true })],
  ["computed flags", (object, key) => Object.defineProperty(object, key, { value: 1, writable: yes(), enumerable: yes(), configurable: !yes() })],
  ["descriptor in a variable", (object, key) => { const descriptor: PropertyDescriptor = { value: 1, enumerable: true }; return Object.defineProperty(object, key, descriptor); }],
  ["Reflect.defineProperty, value", (object, key) => Reflect.defineProperty(object, key, { value: 1, writable: true, enumerable: true, configurable: true })],
  ["Reflect.defineProperty, value with the defaults", (object, key) => Reflect.defineProperty(object, key, { value: 1 })],
  ["Reflect.defineProperty, accessor", (object, key) => Reflect.defineProperty(object, key, { get: getter, set: setter, enumerable: true })],
  ["Object.defineProperties, value", (object, key) => Object.defineProperties(object, { [key]: { value: 1, writable: true, enumerable: true, configurable: true } })],
  ["Object.defineProperties, accessor", (object, key) => Object.defineProperties(object, { [key]: { get: getter, configurable: true } })],
];

interface Pair {
  a: number;
  b?: number;
}
class Point {
  x: number;
  y: number;
  declare late?: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
}
class Point3 extends Point {
  z = 3;
}
const tag = Symbol("tag");

function pair(): Pair {
  return { a: 1 };
}
function point(): Point {
  return new Point(1, 2);
}
function point3(): Point3 {
  return new Point3(1, 2);
}
function withAddedProperties(): Point {
  const made = new Point(1, 2);
  (made as any).first = "first";
  Object.defineProperty(made, "hidden", { value: "hidden", configurable: true });
  return made;
}
function withDeletedField(): Point {
  const made = new Point(1, 2);
  delete (made as any).y;
  return made;
}
function crowded(): Point {
  const made = new Point(1, 2);
  for (let i = 0; i < 200; i++) (made as any)["k" + i] = i;
  return made;
}
function crowdedWithGaps(): Point {
  const made = crowded();
  for (let i = 0; i < 200; i += 3) delete (made as any)["k" + i];
  return made;
}

function textOf(value: unknown): string {
  return typeof value === "function" ? "function " + value.name : String(value);
}
function partsOf(descriptor: PropertyDescriptor): string {
  const flags = (descriptor.writable ? "w" : "-") + (descriptor.enumerable ? "e" : "-") + (descriptor.configurable ? "c" : "-");
  if ("value" in descriptor) return "=" + textOf(descriptor.value) + " " + flags;
  return "(" + textOf(descriptor.get) + "," + textOf(descriptor.set) + ") " + flags;
}
function whole(object: object): string {
  const all = Object.getOwnPropertyDescriptors(object) as Record<PropertyKey, PropertyDescriptor>;
  return Reflect.ownKeys(all).map(key => String(key) + partsOf(all[key])).join(", ");
}
function listed(object: object): string {
  const inLoop: string[] = [];
  for (const key in object) inLoop.push(key);
  return "keys " + Object.keys(object).join() + " for-in " + inLoop.join() + " json " + JSON.stringify(object);
}
function messageOf(action: () => unknown): string {
  try {
    return String(action());
  } catch (error) {
    return (error as Error).name + ": " + (error as Error).message;
  }
}
function kindOf(action: () => unknown): string {
  try {
    return String(action());
  } catch (error) {
    return (error as Error).name;
  }
}

function readPair(object: Pair): string {
  return object.a + "," + object.b;
}
function readPoint(object: Point): string {
  return object.x + "," + object.y + "," + object.late;
}
function callSum(object: Point): string {
  return kindOf(() => object.sum());
}
// Typed code is shown a required field only while it holds what its type says.
function seenByTypedCode(object: object): string {
  const untyped = object as any;
  if (object instanceof Point) {
    if (typeof untyped.x !== "number" || typeof untyped.y !== "number") return "late " + object.late;
    const own = object instanceof Point3 && typeof untyped.z === "number" ? " z " + object.z : "";
    return readPoint(object) + " sum " + callSum(object) + own;
  }
  if (typeof untyped.a !== "number") return "b " + (object as Pair).b;
  return readPair(object as Pair);
}
function uses(object: object, key: PropertyKey): string {
  const untyped = object as any;
  return [
    "has " + (key in object) + " " + Object.hasOwn(object, key),
    "read " + kindOf(() => untyped[key]),
    "store " + kindOf(() => { untyped[key] = 5; return untyped[key]; }) + " " + String(stored),
    "delete " + kindOf(() => delete untyped[key]) + " " + Object.hasOwn(object, key),
  ].join(" ");
}
function everything(object: object, key: PropertyKey): string {
  return [whole(object), listed(object), seenByTypedCode(object), uses(object, key)].join(" | ");
}
function inBrief(object: object, key: PropertyKey): string {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  const keys = Object.keys(object);
  return [descriptor ? String(key) + partsOf(descriptor) : "absent", Reflect.ownKeys(object).length, keys.length, keys.slice(-2).join(), seenByTypedCode(object), uses(object, key)].join(" | ");
}

const lines: string[] = [];
function outcome(create: () => object, key: PropertyKey, define: Define, tell: (object: object, key: PropertyKey) => string): string {
  const object = create();
  stored = "nothing";
  const result = messageOf(() => {
    const returned = define(object, key);
    return returned === object ? "defined" : returned;
  });
  return result + " | " + tell(object, key);
}
// The ways that end alike share a line.
function report(title: string, create: () => object, key: PropertyKey, ways: Way[], tell: (object: object, key: PropertyKey) => string): void {
  const groups = new Map<string, string[]>();
  for (const [label, define] of ways) {
    const first = outcome(create, key, define, tell);
    for (let turn = 2; turn <= 3; turn++) {
      const again = outcome(create, key, define, tell);
      if (again !== first) lines.push(title + ", " + label + ", differs in turn " + turn + ": " + again);
    }
    const labels = groups.get(first);
    if (labels) labels.push(label);
    else groups.set(first, [label]);
  }
  lines.push(title);
  for (const [result, labels] of groups) lines.push("  " + labels.join(" ; "), "    " + result);
}

const cases: [string, () => object, PropertyKey][] = [
  ["literal, new name", pair, "extra"],
  ["literal, symbol", pair, tag],
  ["literal, index", pair, 0],
  ["literal, index as text", pair, "7"],
  ["literal, number past the indexes", pair, 4294967295],
  ["literal, field", pair, "a"],
  ["literal, empty field", pair, "b"],
  ["literal, __proto__", pair, "__proto__"],
  ["instance, new name", point, "extra"],
  ["instance, symbol", point, tag],
  ["instance, well-known symbol", point, Symbol.toStringTag],
  ["instance, index", point, 0],
  ["instance, field", point, "x"],
  ["instance, empty field", point, "late"],
  ["instance, deleted field", withDeletedField, "y"],
  ["instance, name of a method", point, "sum"],
  ["instance, __proto__", point, "__proto__"],
  ["instance of a subclass, new name", point3, "extra"],
  ["instance of a subclass, field of the base class", point3, "x"],
  ["instance of a subclass, own field", point3, "z"],
  ["instance of a subclass, empty field of the base class", point3, "late"],
  ["instance with added properties, new name", withAddedProperties, "extra"],
  ["instance with added properties, symbol", withAddedProperties, tag],
  ["instance with added properties, added name", withAddedProperties, "first"],
  ["instance with added properties, added hidden name", withAddedProperties, "hidden"],
  ["instance with added properties, empty field", withAddedProperties, "late"],
  ["frozen literal, new name", () => Object.freeze(pair()), "extra"],
  ["frozen literal, symbol", () => Object.freeze(pair()), tag],
  ["frozen literal, index", () => Object.freeze(pair()), 0],
  ["frozen literal, field", () => Object.freeze(pair()), "a"],
  ["frozen literal, empty field", () => Object.freeze(pair()), "b"],
  ["sealed literal, new name", () => Object.seal(pair()), "extra"],
  ["sealed literal, symbol", () => Object.seal(pair()), tag],
  ["sealed literal, index", () => Object.seal(pair()), 0],
  ["sealed literal, field", () => Object.seal(pair()), "a"],
  ["sealed literal, empty field", () => Object.seal(pair()), "b"],
  ["literal that is not extensible, new name", () => Object.preventExtensions(pair()), "extra"],
  ["literal that is not extensible, symbol", () => Object.preventExtensions(pair()), tag],
  ["literal that is not extensible, index", () => Object.preventExtensions(pair()), 0],
  ["literal that is not extensible, field", () => Object.preventExtensions(pair()), "a"],
  ["literal that is not extensible, empty field", () => Object.preventExtensions(pair()), "b"],
  ["frozen instance, new name", () => Object.freeze(point()), "extra"],
  ["frozen instance, symbol", () => Object.freeze(point()), tag],
  ["frozen instance, index", () => Object.freeze(point()), 0],
  ["frozen instance, field", () => Object.freeze(point()), "x"],
  ["frozen instance, empty field", () => Object.freeze(point()), "late"],
  ["sealed instance, new name", () => Object.seal(point()), "extra"],
  ["sealed instance, symbol", () => Object.seal(point()), tag],
  ["sealed instance, index", () => Object.seal(point()), 0],
  ["sealed instance, field", () => Object.seal(point()), "x"],
  ["sealed instance, empty field", () => Object.seal(point()), "late"],
  ["instance that is not extensible, new name", () => Object.preventExtensions(point()), "extra"],
  ["instance that is not extensible, symbol", () => Object.preventExtensions(point()), tag],
  ["instance that is not extensible, index", () => Object.preventExtensions(point()), 0],
  ["instance that is not extensible, field", () => Object.preventExtensions(point()), "x"],
  ["instance that is not extensible, empty field", () => Object.preventExtensions(point()), "late"],
  ["instance that is not extensible, deleted field", () => Object.preventExtensions(withDeletedField()), "y"],
  ["frozen instance with added properties, new name", () => Object.freeze(withAddedProperties()), "extra"],
  ["frozen instance with added properties, added name", () => Object.freeze(withAddedProperties()), "first"],
  ["instance with added properties that is not extensible, new name", () => Object.preventExtensions(withAddedProperties()), "extra"],
  ["instance with added properties that is not extensible, added name", () => Object.preventExtensions(withAddedProperties()), "first"],
];
const casesOfOtherWays = new Set([
  "literal, new name",
  "literal, symbol",
  "literal, index",
  "literal, field",
  "literal, empty field",
  "instance, new name",
  "instance, empty field",
  "instance, deleted field",
  "instance with added properties, new name",
  "instance with added properties, added name",
  "frozen literal, new name",
  "sealed instance, empty field",
  "instance that is not extensible, new name",
]);
for (const [title, create, key] of cases) {
  report(title, create, key, literals, everything);
  if (casesOfOtherWays.has(title)) report(title + ", in other ways", create, key, otherWays, everything);
}
report("instance with 200 added properties, new name", crowded, "extra", literals, inBrief);
report("instance with 200 added properties, added name", crowded, "k100", literals, inBrief);
report("instance with 200 added properties of which some were deleted, new name", crowdedWithGaps, "extra", literals, inBrief);
report("instance with 200 added properties of which some were deleted, deleted name", crowdedWithGaps, "k99", literals, inBrief);

// The names come in the order in which they were created, whether they are fields or not.
const orderedPair: Pair = { a: 1 };
Object.defineProperty(orderedPair, "second", { value: 2, enumerable: true });
Object.defineProperty(orderedPair, tag, { value: 3, enumerable: true });
Object.defineProperty(orderedPair, "b", { value: 4, writable: true, enumerable: true, configurable: true });
Object.defineProperty(orderedPair, 1, { value: 5, enumerable: true });
Object.defineProperty(orderedPair, "third", { get: getter, enumerable: true });
Object.defineProperty(orderedPair, 0, { value: 6, enumerable: true });
lines.push("order on a literal: " + whole(orderedPair) + " | " + listed(orderedPair) + " | " + readPair(orderedPair));
const orderedPoint = new Point(1, 2);
Object.defineProperty(orderedPoint, "second", { value: 2, enumerable: true });
Object.defineProperty(orderedPoint, tag, { value: 3, enumerable: true });
Object.defineProperty(orderedPoint, "late", { value: 4, writable: true, enumerable: true, configurable: true });
Object.defineProperty(orderedPoint, 1, { value: 5, enumerable: true });
Object.defineProperty(orderedPoint, "third", { get: getter, enumerable: true });
Object.defineProperty(orderedPoint, 0, { value: 6, enumerable: true });
lines.push("order on an instance: " + whole(orderedPoint) + " | " + listed(orderedPoint) + " | " + readPoint(orderedPoint));

// Whoever looked for the name in vain, on the object or on an object that inherits from it, finds it afterwards.
function readExtra(object: any): unknown {
  return object.extra;
}
function hasExtra(object: object): boolean {
  return "extra" in object;
}
for (const [title, create] of [["literal", pair], ["instance", point]] as [string, () => object][]) {
  const parent = create();
  const child: object = Object.create(parent);
  let missed = 0;
  for (let i = 0; i < 300; i++) if (readExtra(child) === undefined && readExtra(parent) === undefined && !hasExtra(child) && !hasExtra(parent)) missed++;
  Object.defineProperty(parent, "extra", { value: "inherited", enumerable: true });
  lines.push("below a " + title + ": " + [missed, readExtra(child), readExtra(parent), hasExtra(child), hasExtra(parent), Object.hasOwn(child, "extra"), listed(child)].join(" "));
  const other = create();
  Object.defineProperty(other, "extra", { get: getter });
  lines.push("another " + title + ": " + [readExtra(other), hasExtra(other), readExtra(create()), hasExtra(create()), listed(other)].join(" "));
}

// An accessor gets the object that was read or stored to, and a function is called on it.
const owner = new Point(10, 20);
Object.defineProperty(owner, "double", { get(this: any) { return this.x * 2; }, set(this: any, value: number) { this.x = value; }, configurable: true });
Object.defineProperty(owner, "plus", { value(this: any, more: number) { return this.x + more; } });
const heir: any = Object.create(owner);
lines.push("receivers: " + [(owner as any).double, heir.double, (owner as any).plus(1), heir.plus(2)].join(" "));
heir.double = 4;
lines.push("receivers after a store: " + [owner.x, heir.x, Object.hasOwn(heir, "x"), (owner as any).double, heir.double, heir.plus(2), whole(owner)].join(" "));

// The same definitions on many objects, read after a collection.
const many: Point[] = [];
for (let i = 0; i < 3000; i++) {
  const made = new Point(i, -i);
  if (i % 3 === 0) Object.defineProperty(made, "extra", { value: i, writable: true, enumerable: true, configurable: true });
  else if (i % 3 === 1) Object.defineProperty(made, "extra", { value: i });
  else Object.defineProperty(made, "extra", { get: getter, enumerable: true });
  if (i % 5 === 0) Object.defineProperty(made, tag, { value: "tagged" });
  if (i % 7 === 0) Object.defineProperty(made, "late", { value: i, writable: true, enumerable: true, configurable: true });
  many.push(made);
}
Bun.gc(true);
let right = 0;
for (let i = 0; i < many.length; i++) {
  const made = many[i];
  const untyped = made as any;
  if (untyped.extra !== (i % 3 === 2 ? 7 : i)) continue;
  if (Object.keys(made).includes("extra") !== (i % 3 !== 1)) continue;
  if ((untyped[tag] === "tagged") !== (i % 5 === 0)) continue;
  if (made.late !== (i % 7 === 0 ? i : undefined)) continue;
  if (made.x === i && made.y === -i && made.sum() === 0) right++;
}
lines.push("3000 objects: " + right);

console.log(lines.join("\n"));
export {};
