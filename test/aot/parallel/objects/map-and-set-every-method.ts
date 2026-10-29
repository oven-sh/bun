// Every method of Map and Set behaves as in plain Bun, for tables of every size from empty to a few hundred entries, and for keys and values of every kind: strings, integers, doubles, objects, symbols, bigints, and all of them in one table.
const objects = Array.from({ length: 700 }, (_, index) => ({ id: index }));
const symbols = Array.from({ length: 700 }, (_, index) => Symbol("s" + index));

function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return String(value);
  if (Array.isArray(value)) return "[" + shorten(value.map(show)) + "]";
  if (value instanceof Map) return "Map(" + value.size + "){" + shorten(Array.from(value, ([key, item]) => show(key) + "=>" + show(item))) + "}";
  if (value instanceof Set) return "Set(" + value.size + "){" + shorten(Array.from(value, show)) + "}";
  if (typeof value === "object" && value !== null) return "{id " + (value as { id: number }).id + "}";
  return String(value);
}
function shorten(parts: string[]): string {
  if (parts.length <= 6) return parts.join(",");
  let sum = 0;
  for (const part of parts) for (let i = 0; i < part.length; i++) sum = (Math.imul(sum, 31) + part.charCodeAt(i)) | 0;
  return parts.slice(0, 2).join(",") + ",..(" + parts.length + " in all, checksum " + sum + ")..," + parts.slice(-2).join(",");
}

type KeyAt = (index: number) => unknown;
const kinds: [string, KeyAt][] = [
  ["strings", index => "k" + index],
  ["integers", index => index],
  ["doubles", index => index + 0.5],
  ["objects", index => objects[index]],
  ["symbols", index => symbols[index]],
  ["bigints", index => BigInt(index) << 70n],
  ["mixed", index => [undefined, null, true, false, NaN, "", "k" + index, index, index + 0.5, objects[index], symbols[index], BigInt(index)][index < 6 ? index : 6 + (index % 6)]],
];
const sizes = [0, 1, 4, 5, 8, 9, 254, 255, 300];
const absent = 600;

function createMap(count: number, keyAt: KeyAt, valueAt: KeyAt): Map<unknown, unknown> {
  const map = new Map<unknown, unknown>();
  for (let index = 0; index < count; index++) map.set(keyAt(index), valueAt(index));
  return map;
}
function createSet(count: number, keyAt: KeyAt, from = 0): Set<unknown> {
  const set = new Set<unknown>();
  for (let index = from; index < from + count; index++) set.add(keyAt(index));
  return set;
}

function runMap(label: string, count: number, keyAt: KeyAt, valueAt: KeyAt): void {
  const say = (what: string, ...values: unknown[]) => console.log(label + " " + what + ": " + values.map(show).join(" "));
  const last = Math.max(count - 1, 0);
  const middle = count >> 1;
  const map = createMap(count, keyAt, valueAt);
  say("size", map.size, map);
  say("has", map.has(keyAt(0)), map.has(keyAt(middle)), map.has(keyAt(last)), map.has(keyAt(count)), map.has(keyAt(absent)));
  say("get", map.get(keyAt(0)), map.get(keyAt(middle)), map.get(keyAt(last)), map.get(keyAt(count)), map.get(keyAt(absent)));
  say("keys, values, entries", [...map.keys()], [...map.values()], [...map.entries()], [...map[Symbol.iterator]()]);

  const visited: unknown[] = [];
  const receiver = { id: -1 };
  map.forEach(function (this: unknown, value, key, owner) {
    visited.push([key, value, owner === map, this === receiver]);
  }, receiver);
  say("forEach", visited);

  say("set a present key", map.set(keyAt(middle), "replaced") === map, map.size, map.get(keyAt(middle)), [...map.keys()]);
  say("set an absent key", map.set(keyAt(absent), 0.25) === map, map.size, map.get(keyAt(absent)), [...map.keys()].at(-1));
  say("getOrInsert", map.getOrInsert(keyAt(0), "inserted"), map.getOrInsert(keyAt(absent + 1), "inserted"), map.size);
  say("getOrInsertComputed", map.getOrInsertComputed(keyAt(0), key => [key]), map.getOrInsertComputed(keyAt(absent + 2), key => [key]), map.size);
  say("delete", map.delete(keyAt(0)), map.delete(keyAt(0)), map.delete(keyAt(middle)), map.delete(keyAt(last)), map.delete(keyAt(absent + 3)), map.size);
  say("after delete", map.has(keyAt(0)), map.get(keyAt(0)), map);
  say("set a deleted key", map.set(keyAt(0), "again").size, [...map.keys()].at(-1), map.get(keyAt(0)));

  const copies = [new Map(map), new Map(map.entries()), new Map([...map]), new Map(Array.from(map))];
  map.set(keyAt(absent + 4), "only in the original");
  copies[0].set(keyAt(absent + 5), "only in the copy");
  say("copies", copies.map(copy => copy.size), map.size, copies[0].has(keyAt(absent + 4)), map.has(keyAt(absent + 5)), copies[1]);

  for (let index = 0; index < count; index++) map.delete(keyAt(index));
  say("every first key deleted", map);
  say("clear", map.clear(), map.size, map.has(keyAt(absent)), map.get(keyAt(absent)), [...map], map.delete(keyAt(absent)));
  say("filled again", map.set(keyAt(1), 1).set(keyAt(0), 0).size, map);
}

function runSet(label: string, count: number, keyAt: KeyAt): void {
  const say = (what: string, ...values: unknown[]) => console.log(label + " " + what + ": " + values.map(show).join(" "));
  const last = Math.max(count - 1, 0);
  const middle = count >> 1;
  const set = createSet(count, keyAt);
  say("size", set.size, set);
  say("has", set.has(keyAt(0)), set.has(keyAt(middle)), set.has(keyAt(last)), set.has(keyAt(count)), set.has(keyAt(absent)));
  say("keys, values, entries", [...set.keys()], [...set.values()], [...set.entries()], [...set[Symbol.iterator]()]);

  const visited: unknown[] = [];
  const receiver = { id: -1 };
  set.forEach(function (this: unknown, value, key, owner) {
    visited.push([key, value, owner === set, this === receiver]);
  }, receiver);
  say("forEach", visited);

  const others: [string, Set<unknown>][] = [
    ["empty", new Set()],
    ["a copy", new Set(set)],
    ["the first half", createSet(middle, keyAt)],
    ["overlapping", createSet(count, keyAt, middle)],
    ["larger", createSet(count + 20, keyAt)],
    ["keys of other kinds", new Set<unknown>(["k0", 0, 0.5, objects[0], symbols[0], 0n, undefined])],
  ];
  for (const [name, other] of others) {
    say("with " + name, set.union(other), set.intersection(other), set.difference(other), set.symmetricDifference(other), set.isSubsetOf(other), set.isSupersetOf(other), set.isDisjointFrom(other));
    say("from " + name, other.union(set), other.intersection(set), other.difference(set), other.symmetricDifference(set), other.isSubsetOf(set), other.isSupersetOf(set), other.isDisjointFrom(set));
  }
  const map = createMap(middle + 1, keyAt, index => index);
  say("with a map", set.union(map), set.intersection(map), set.difference(map), set.symmetricDifference(map), set.isSubsetOf(map), set.isSupersetOf(map), set.isDisjointFrom(map));
  const setLike = { size: 2, has: (key: unknown) => key === keyAt(0), keys: () => [keyAt(0), keyAt(absent)].values() };
  say("with a set-like object", set.union(setLike), set.intersection(setLike), set.difference(setLike), set.symmetricDifference(setLike), set.isSubsetOf(setLike), set.isSupersetOf(setLike), set.isDisjointFrom(setLike));
  say("unchanged", set);

  say("add a present key", set.add(keyAt(middle)) === set, set.size, [...set]);
  say("add an absent key", set.add(keyAt(absent)) === set, set.size, set.has(keyAt(absent)), [...set].at(-1));
  say("delete", set.delete(keyAt(0)), set.delete(keyAt(0)), set.delete(keyAt(middle)), set.delete(keyAt(last)), set.delete(keyAt(absent + 3)), set.size);
  say("after delete", set.has(keyAt(0)), set);
  say("add a deleted key", set.add(keyAt(0)).size, [...set].at(-1));

  const copies = [new Set(set), new Set(set.values()), new Set([...set]), new Set(Array.from(set))];
  set.add(keyAt(absent + 4));
  copies[0].add(keyAt(absent + 5));
  say("copies", copies.map(copy => copy.size), set.size, copies[0].has(keyAt(absent + 4)), set.has(keyAt(absent + 5)), copies[1]);

  for (let index = 0; index < count; index++) set.delete(keyAt(index));
  say("every first key deleted", set);
  say("clear", set.clear(), set.size, set.has(keyAt(absent)), [...set], set.delete(keyAt(absent)));
  say("filled again", set.add(keyAt(1)).add(keyAt(0)).size, set);
}

const valueKinds: [string, KeyAt][] = [
  ["to strings", index => "v" + index],
  ["to integers", index => index],
  ["to doubles", index => index / 4],
  ["to anything", index => [undefined, null, "v" + index, index, index / 4, objects[index], true][index % 7]],
];
for (const [kind, keyAt] of kinds) {
  for (const count of kind === "strings" ? sizes : [0, 5, 9, 255]) {
    const hasEveryValueKind = count === 9 && (kind === "strings" || kind === "objects");
    for (const [valueKind, valueAt] of hasEveryValueKind ? valueKinds : valueKinds.slice(3)) runMap("map of " + count + " " + kind + " " + valueKind, count, keyAt, valueAt);
    runSet("set of " + count + " " + kind, count, keyAt);
  }
}

const words = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
console.log(show(Map.groupBy(words, word => word.length)), show(Map.groupBy(words, word => word[0])), show(Map.groupBy(words, word => objects[word.length % 2])), show(Map.groupBy([], () => 1)));
console.log(show(Map.groupBy([0, -0, NaN, NaN, 1, 1.0], value => value)));
console.log(show(new Map()), show(new Map(null)), show(new Map(undefined)), show(new Set()), show(new Set(null)), show(new Set(undefined)), show(new Set("hello")), show(new Map([[1, 2], [1, 3], [-0, 4], [0, 5]])), show(new Set([NaN, NaN, -0, 0, 1n, BigInt(1), "a", "a"])));
console.log(Object.prototype.toString.call(new Map()), Object.prototype.toString.call(new Set()), Map[Symbol.species] === Map, Set[Symbol.species] === Set, Set.prototype.keys === Set.prototype.values, Map.prototype[Symbol.iterator] === Map.prototype.entries, Set.prototype[Symbol.iterator] === Set.prototype.values);

function outcome(run: () => unknown): string {
  try {
    return show(run());
  } catch (error) {
    return (error as Error).name;
  }
}
function attempt(label: string, run: () => unknown): void {
  console.log(label + ": " + outcome(run));
}
const mapMethods: any = Map.prototype;
const setMethods: any = Set.prototype;
const mapMethodNames = ["get", "set", "has", "delete", "clear", "keys", "values", "entries", "forEach", "getOrInsert", "getOrInsertComputed"];
const setMethodNames = ["add", "has", "delete", "clear", "keys", "values", "entries", "forEach", "union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom"];
for (const [label, receiver] of [["a set", new Set([1])], ["a weak map", new WeakMap()], ["an object", {}], ["undefined", undefined]] as [string, unknown][]) {
  console.log("methods of Map on " + label + ": " + mapMethodNames.map(name => name + " " + outcome(() => mapMethods[name].call(receiver, 1, () => 1))).join(", "));
}
for (const [label, receiver] of [["a map", new Map([[1, 1]])], ["a weak set", new WeakSet()], ["an object", {}], ["undefined", undefined]] as [string, unknown][]) {
  console.log("methods of Set on " + label + ": " + setMethodNames.map(name => name + " " + outcome(() => setMethods[name].call(receiver, new Set([1])))).join(", "));
}
attempt("the size of a map read on a set", () => Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!.call(new Set()));
attempt("the size of a set read on a map", () => Object.getOwnPropertyDescriptor(Set.prototype, "size")!.get!.call(new Map()));
attempt("forEach without a function", () => mapMethods.forEach.call(new Map(), 1));
attempt("getOrInsertComputed without a function", () => mapMethods.getOrInsertComputed.call(new Map(), 1, 1));
attempt("getOrInsertComputed whose callback throws", () => new Map().getOrInsertComputed(1, () => { throw new RangeError("no value"); }));
attempt("getOrInsertComputed whose callback sets the key", () => { const map = new Map<number, string>(); return [map.getOrInsertComputed(1, key => { map.set(key, "set by the callback"); return "computed"; }), map]; });
attempt("union with an array", () => setMethods.union.call(new Set([1]), [1]));
attempt("a map from numbers", () => new Map([1, 2] as any));
attempt("Map without new", () => (Map as any)());
attempt("Set without new", () => (Set as any)());
