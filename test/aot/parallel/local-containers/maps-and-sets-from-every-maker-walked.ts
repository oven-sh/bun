// Compiled code reads the table of a Map or a Set without asking what kind of storage it is: in an executable every Map and every Set has the compiled kind, whoever made it. Here each maker there is makes one (the constructors over every kind of source, copies, the Set methods, groupBy, structuredClone, the deserializer, a message channel's clone, subclasses, another realm, host objects that hand out Maps), and each is walked, asked and changed by fast code and by cold code
import { deserialize, serialize } from "node:v8";
import { runInNewContext } from "node:vm";

const opaque = <T>(value: T): T => Reflect.get({ value }, ["val", "ue"].join("")) as T;
const lines: string[] = [];
const show = (value: unknown): string => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));

function walkMap(map: Map<unknown, unknown>): string {
  let text = "";
  for (const [key, value] of map) text += show(key) + ">" + show(value) + ";";
  return text;
}
function walkSet(set: Set<unknown>): string {
  let text = "";
  for (const key of set) text += show(key) + ";";
  return text;
}
function walkByMethods(collection: Map<unknown, unknown> | Set<unknown>): string {
  let text = "";
  collection.forEach((value: unknown, key: unknown) => { text += show(key) + "=" + show(value) + ","; });
  text += "|" + [...collection.keys()].map(show).join() + "|" + [...collection.values()].map(show).join() + "|" + Array.from(collection.entries(), pair => pair.map(show).join(":")).join();
  const iterator = collection[Symbol.iterator]();
  for (let step = iterator.next(); !step.done; step = iterator.next()) text += "/" + show(step.value);
  return text;
}
function lookAtMap(title: string, map: Map<unknown, unknown>): void {
  const keys = [...map.keys()];
  let text = title + " size " + map.size + " by value " + Reflect.get(map, "size") + ": " + walkMap(map) + " " + walkByMethods(map);
  for (const key of keys) text += " " + map.has(key) + show(map.get(key));
  text += " " + map.has("absent") + show(map.get("absent"));
  // Entries come and go under a walk that is under way.
  let steps = 0;
  for (const [key] of map) {
    if (steps === 0) { map.set("added " + title, steps); map.delete(keys[keys.length - 1]); }
    if (++steps > 50) break;
    text += "~" + show(key);
  }
  map.set(1.5, "wide"); map.set("text", { a: 1 });
  text += " then " + map.size + ": " + walkMap(map);
  map.clear();
  text += " cleared " + map.size + walkMap(map);
  map.set("again", 1);
  lines.push(text + " " + walkMap(map));
}
function lookAtSet(title: string, set: Set<unknown>): void {
  const keys = [...set];
  let text = title + " size " + set.size + " by value " + Reflect.get(set, "size") + ": " + walkSet(set) + " " + walkByMethods(set);
  for (const key of keys) text += " " + set.has(key);
  text += " " + set.has("absent");
  let steps = 0;
  for (const key of set) {
    if (steps === 0) { set.add("added " + title); set.delete(keys[keys.length - 1]); }
    if (++steps > 50) break;
    text += "~" + show(key);
  }
  set.add(1.5); set.add("text");
  text += " then " + set.size + ": " + walkSet(set);
  set.clear();
  text += " cleared " + set.size + walkSet(set);
  set.add("again");
  lines.push(text + " " + walkSet(set));
}

const pairs: [unknown, unknown][] = [["a", 1], ["b", { x: 2 }], [3, "three"], [null, undefined], [true, 4.5]];
const items: unknown[] = ["a", "b", 3, null, true, 4.5, undefined];
function* generated<T>(list: T[]): Generator<T> { for (const item of list) yield item; }
class OwnMap<K, V> extends Map<K, V> { tag = "own"; }
class OwnSet<T> extends Set<T> { tag = "own"; }
const source = new Map(pairs), sourceSet = new Set(items);

const maps: Record<string, () => Map<unknown, unknown>> = {
  empty: () => new Map(),
  "of null": () => new Map(null),
  "of an array": () => new Map(pairs),
  "of a generator": () => new Map(generated(pairs)),
  "of a map": () => new Map(source),
  "of an empty map": () => new Map(new Map()),
  "of entries": () => new Map(source.entries()),
  "of object entries": () => new Map<unknown, unknown>(Object.entries({ p: 1, q: "two" })),
  "by value": () => new (opaque(Map))(pairs),
  "by Reflect": () => Reflect.construct(Map, [pairs]),
  "by Reflect for a subclass": () => Reflect.construct(Map, [pairs], OwnMap),
  subclass: () => new OwnMap(pairs),
  "copy of a subclass": () => new Map(new OwnMap(pairs)),
  groupBy: () => Map.groupBy([1, 2, 3, 4, 5], n => (n % 2 ? "odd" : "even")),
  structuredClone: () => structuredClone(source),
  "structuredClone of an empty one": () => structuredClone(new Map()),
  "inside a clone": () => (structuredClone({ inner: [source] }) as { inner: Map<unknown, unknown>[] }).inner[0],
  deserialized: () => deserialize(serialize(source)),
  "another realm": () => runInNewContext("new Map([['a', 1], [2, 'b']])"),
  "another realm's constructor": () => new (runInNewContext("Map"))(pairs),
  "search parameters": () => new Map(new URLSearchParams("a=1&b=2&a=3")),
  headers: () => new Map(new Headers({ "x-a": "1", "x-b": "2" })),
  "form data": () => { const form = new FormData(); form.append("f", "1"); form.append("g", "2"); return new Map(form as unknown as Iterable<[unknown, unknown]>); },
  "filled by getOrInsert": () => { const map = new Map<unknown, unknown>(); const any = map as any; if (typeof any.getOrInsert === "function") { any.getOrInsert("a", 1); any.getOrInsertComputed("b", () => 2); } else { map.set("a", 1); map.set("b", 2); } return map; },
};
const sets: Record<string, () => Set<unknown>> = {
  empty: () => new Set(),
  "of undefined": () => new Set(undefined),
  "of an array": () => new Set(items),
  "of numbers": () => new Set([1, 2, 3, 4.5]),
  "of a string": () => new Set("hello"),
  "of a generator": () => new Set(generated(items)),
  "of a set": () => new Set(sourceSet),
  "of an empty set": () => new Set(new Set()),
  "of keys of a map": () => new Set(source.keys()),
  "by value": () => new (opaque(Set))(items),
  "by Reflect": () => Reflect.construct(Set, [items]),
  subclass: () => new OwnSet(items),
  "copy of a subclass": () => new Set(new OwnSet(items)),
  union: () => sourceSet.union(new Set(["z", 9])),
  "union with a map": () => sourceSet.union(source),
  intersection: () => sourceSet.intersection(new Set(["a", 3, "z"])),
  difference: () => sourceSet.difference(new Set(["a", 3, "z"])),
  symmetricDifference: () => sourceSet.symmetricDifference(new Set(["a", 3, "z"])),
  "union of empty ones": () => new Set().union(new Set()),
  structuredClone: () => structuredClone(sourceSet),
  deserialized: () => deserialize(serialize(sourceSet)),
  "another realm": () => runInNewContext("new Set(['a', 1, 2.5])"),
  "typed array": () => new Set(new Uint8Array([1, 2, 2, 3])),
};
for (let round = 0; round < 3; round++) {
  for (const title in maps) lookAtMap(title, maps[title]());
  for (const title in sets) lookAtSet(title, sets[title]());
}
lines.push(String(sourceSet.isSubsetOf(sourceSet.union(new Set([0])))) + sourceSet.isSupersetOf(new Set(["a"])) + sourceSet.isDisjointFrom(new Set(["q"])));

// A clone that came through a message channel.
const channel = new MessageChannel();
const received = new Promise<{ map: Map<unknown, unknown>; set: Set<unknown> }>(resolve => { channel.port2.onmessage = event => resolve(event.data); });
channel.port1.postMessage({ map: source, set: sourceSet });
const message = await received;
channel.port1.close(); channel.port2.close();
lookAtMap("received", message.map);
lookAtSet("received", message.set);

const makers = Object.keys(maps).length + Object.keys(sets).length;
console.log(lines.length, makers);
console.log(lines.slice(0, makers).join("\n"));
console.log(lines.slice(-3).join("\n"));
console.log(lines.slice(0, makers).join() === lines.slice(makers, 2 * makers).join(), lines.slice(makers, 2 * makers).join() === lines.slice(2 * makers, 3 * makers).join());
