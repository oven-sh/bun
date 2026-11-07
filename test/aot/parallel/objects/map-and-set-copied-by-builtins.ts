// Anything that reads a whole Map or Set at once sees its live entries in insertion order: `Array.from`, spread into an array and into a call, array patterns, the constructors of Map, Set and typed arrays, `Object.fromEntries`, `yield*` and the iterator helpers, for tables of every size, after deletions and after `clear`. A table that has its own iterator method is read through that method.
const objects = Array.from({ length: 700 }, (_, index) => ({ id: index }));
const symbols = Array.from({ length: 700 }, (_, index) => Symbol("s" + index));

function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return String(value);
  if (Array.isArray(value)) return "[" + shorten(value.map(show)) + "]";
  if (value instanceof Map) return "Map{" + shorten(Array.from(value, ([key, item]) => show(key) + "=>" + show(item))) + "}";
  if (value instanceof Set) return "Set{" + shorten(Array.from(value, show)) + "}";
  if (ArrayBuffer.isView(value)) return value.constructor.name + "[" + shorten(Array.from(value as Float64Array, show)) + "]";
  if (typeof value === "object" && value !== null) return "id" in value ? "#" + value.id : "{" + shorten(Reflect.ownKeys(value).map(key => String(key) + ":" + show((value as Record<PropertyKey, unknown>)[key]))) + "}";
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
  ["mixed", index => (index === 0 ? undefined : index === 1 ? null : ["k" + index, index, index + 0.5, objects[index], symbols[index], BigInt(index)][index % 6])],
];

function collect(...values: unknown[]): unknown[] { return [values.length, values[0], values.at(-1)]; }
function* delegate(iterable: Iterable<unknown>): Generator<unknown, void, unknown> { yield "first"; yield* iterable; yield "last"; }

function readSet(label: string, set: Set<unknown>): void {
  const say = (what: string, ...values: unknown[]) => console.log(label + " " + what + ": " + values.map(show).join(" "));
  say("Array.from", Array.from(set), Array.from(set, (value, index) => [index, value]), Array.from(set.keys()), Array.from(set.values()), Array.from(set.entries()));
  say("spread", [...set], ["before", ...set, "between", ...set, "after"], [...set.values()], [...set.entries()], collect(...set), Array.of(...set));
  const [first, second, ...rest] = set;
  const [only] = set;
  const [, , , , fifth = "default"] = set;
  say("patterns", first, second, rest, only, fifth);
  say("constructors", new Set(set), new Set(set.values()), new Set([...set, ...set]), new Map(set.entries()), new Set(new Set(set)).size);
  say("yield*", [...delegate(set)], [...delegate(set.values())]);
  say("iterator helpers", set.values().map(value => [value]).toArray(), set.values().filter((_, index) => index % 2 === 0).toArray(), set.values().take(3).toArray(), set.values().drop(2).toArray(), set.keys().flatMap(value => [value, value]).toArray(), Iterator.from(set).toArray(), set.values().some(value => value === first), set.values().reduce((count: number) => count + 1, 0));
}

function readMap(label: string, map: Map<unknown, unknown>): void {
  const say = (what: string, ...values: unknown[]) => console.log(label + " " + what + ": " + values.map(show).join(" "));
  say("Array.from", Array.from(map), Array.from(map, ([key, value], index) => [index, value, key]), Array.from(map.keys()), Array.from(map.values()), Array.from(map.entries()));
  say("spread", [...map], ["before", ...map, "after"], [...map.keys()], [...map.values()], [...map.entries()], collect(...map), collect(...map.keys()));
  const [first, [secondKey, secondValue] = ["no key", "no value"], ...rest] = map;
  say("patterns", first, secondKey, secondValue, rest);
  say("constructors", new Map(map), new Map(map.entries()), new Map([...map, ...map]), new Set(map.keys()), new Set(map.values()), new Set(map).size);
  say("Object.fromEntries", Object.fromEntries(map as Map<PropertyKey, unknown>), Object.fromEntries(map.entries() as MapIterator<[PropertyKey, unknown]>));
  say("yield*", [...delegate(map)], [...delegate(map.keys())]);
  say("iterator helpers", map.entries().map(([key, value]) => [value, key]).toArray(), map.keys().filter((_, index) => index % 2 === 1).toArray(), map.values().take(3).toArray(), map.keys().drop(2).toArray(), Iterator.from(map).toArray());
  const pairs = [...map];
  if (pairs.length > 0) pairs[0][1] = "changed in the copy";
  say("pairs are copies", map.values().next().value, new Set([...map, ...map]).size);
}

for (const [kind, keyAt] of kinds) {
  for (const count of kind === "strings" ? [0, 1, 4, 5, 8, 9, 254, 255, 300] : [0, 5, 9, 255]) {
    const set = new Set<unknown>();
    const map = new Map<unknown, unknown>();
    for (let index = 0; index < count; index++) {
      set.add(keyAt(index));
      map.set(keyAt(index), index % 3 === 0 ? index : keyAt(count - 1 - index));
    }
    readSet("set of " + count + " " + kind, set);
    readMap("map of " + count + " " + kind, map);
    if (count < 5) continue;

    for (let index = 0; index < count; index += 2) {
      set.delete(keyAt(index));
      map.delete(keyAt(index));
    }
    readSet("set of " + count + " " + kind + ", every second deleted", set);
    readMap("map of " + count + " " + kind + ", every second deleted", map);

    for (let index = 0; index < count - 1; index++) {
      set.delete(keyAt(index));
      map.delete(keyAt(index));
    }
    set.add(keyAt(0));
    map.set(keyAt(0), "added again");
    readSet("set of " + count + " " + kind + ", all but the last deleted, the first added again", set);
    readMap("map of " + count + " " + kind + ", all but the last deleted, the first added again", map);

    set.clear();
    map.clear();
    readSet("set of " + count + " " + kind + ", cleared", set);
    readMap("map of " + count + " " + kind + ", cleared", map);
  }
}

const numbers = new Set([1, 2.5, -0, 300, -1, NaN]);
console.log(show(new Float64Array(numbers)), show(new Uint8Array(numbers)), show(Int16Array.from(numbers)), show(Float32Array.from(numbers, value => value * 2)), show(new Float64Array(new Map([[1, 2]]).keys())), Math.max(...new Set([3, 9, 4])), Math.min(...new Map([[3, 1], [2, 5]]).keys()));
console.log(show(new WeakSet(new Set(objects.slice(0, 3))).has(objects[2])), show(new WeakMap(new Map([[objects[0], "weak"]])).get(objects[0])), show(await Promise.all(new Set([1, Promise.resolve(2), "three"]))), show(await Promise.race(new Set(["winner", 2]))));

function ownIterator<T extends object>(table: T, values: unknown[]): T {
  return Object.assign(table, { [Symbol.iterator]: () => values.values() });
}
class ReversedSet extends Set<unknown> {
  *[Symbol.iterator](): SetIterator<unknown> { yield* [...super.values()].reverse(); }
}
class DoubledValues extends Set<unknown> {
  values(): SetIterator<unknown> { return [...super.values()].flatMap(value => [value, value]).values() as SetIterator<unknown>; }
}
class ReversedMap extends Map<unknown, unknown> {
  *[Symbol.iterator](): MapIterator<[unknown, unknown]> { yield* [...super.entries()].reverse(); }
}
class PlainSubclass extends Set<unknown> {}
const tables: [string, Iterable<unknown>][] = [
  ["a set with its own iterator method", ownIterator(new Set(["a", "b"]), ["own"])],
  ["a map with its own iterator method", ownIterator(new Map([["a", 1]]), [["own", "pair"]])],
  ["a subclass that reverses", new ReversedSet(["a", "b", "c"])],
  ["a subclass that replaces values()", new DoubledValues(["a", "b"])],
  ["a subclass of Map that reverses", new ReversedMap([["a", 1], ["b", 2]])],
  ["a subclass that replaces nothing", new PlainSubclass(["a", "b"])],
  ["a set under another prototype", Object.setPrototypeOf(new Set(["a", "b"]), { __proto__: Set.prototype, [Symbol.iterator]: () => ["inherited"].values() })],
  ["a frozen set", Object.freeze(new Set(["a", "b"]))],
];
for (const [label, table] of tables) {
  const [first, ...rest] = table;
  console.log(label + ": " + [Array.from(table), [...table], collect(...table), [first, rest], new Set(table), [...delegate(table)], Iterator.from(table).toArray()].map(show).join(" "));
}
export {};
