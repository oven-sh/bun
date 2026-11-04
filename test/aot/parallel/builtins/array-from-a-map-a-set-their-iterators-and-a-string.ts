// `Array.from(map)`, `Array.from(map.entries())`, `Array.from(text)`: no `next` is called for an object a step. What native code copies at once (a Set, keys, values) still goes that way.
// CALLS+ pairsOf fromIterable|appendIterable
export {};

const lines: string[] = [];
const show = (name: string, list: unknown) => lines.push(name + ": " + JSON.stringify(list) + " " + Array.isArray(list) + " " + (Object.getPrototypeOf(list) === Array.prototype));

function pairsOf(map: Map<string, number>) {
  return Array.from(map);
}
function entriesOf(map: Map<string, number>) {
  return Array.from(map.entries());
}
function keysOf(map: Map<string, number>) {
  return Array.from(map.keys());
}
function valuesOf(map: Map<string, number>) {
  return Array.from(map.values());
}
function membersOf(set: Set<unknown>) {
  return Array.from(set);
}
function lettersOf(text: string) {
  return Array.from(text);
}
function restOf(iterator: Iterable<unknown>) {
  return Array.from(iterator);
}

for (const size of [0, 1, 4, 9, 300]) {
  const map = new Map<string, number>();
  for (let k = 0; k < size; k++) map.set("k" + k, k * 1.5);
  const brief = (list: unknown[]) => (list.length > 9 ? [list.length, list[0], list[list.length - 1]] : list);
  show(size + " pairs", brief(pairsOf(map)));
  show(size + " entries", brief(entriesOf(map)));
  show(size + " keys", brief(keysOf(map)));
  show(size + " values", brief(valuesOf(map)));
  show(size + " members", brief(membersOf(new Set(map.keys()))));
  show(size + " members by values()", brief(restOf(new Set(map.values()).values())));
  show(size + " members by entries()", brief(restOf(new Set(map.values()).entries())));
  map.delete("k0");
  map.set("late", -1);
  show(size + " pairs, one deleted, one late", brief(pairsOf(map)));
}

const map = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
const pairs = pairsOf(map);
pairs[0]![1] = 100;
show("a pair is a copy", [pairs[0], map.get("a"), pairsOf(map)[0] === pairsOf(map)[0]]);
for (const make of [() => map.entries(), () => map.keys(), () => map.values(), () => new Set(map.keys()).values(), () => "añ😀z"[Symbol.iterator]()]) {
  const started = make();
  started.next();
  show("started", restOf(started));
  show("used up", restOf(started));
  show("asked behind its end", started.next());
}
show("letters", lettersOf("añ😀z\ud800!"));
show("no letters", lettersOf(""));
show("a rope", lettersOf("ab".repeat(3) + String(map.size)));
show("undefined for the mapper", [Array.from(map, undefined!), Array.from("xy", undefined!), Array.from(map.keys(), undefined!)]);
show("a mapper", [Array.from(map, ([key, value]) => key + value), Array.from(map.values(), (value, index) => value * index)]);

class Pile extends Array<unknown> {}
const pile = Pile.from(map);
lines.push("below Array: " + (pile instanceof Pile) + " " + JSON.stringify(pile));
function Plain(this: { made: boolean }) {
  this.made = true;
}
lines.push("another constructor: " + JSON.stringify((Array.from as Function).call(Plain, map.keys())));
lines.push("no constructor: " + JSON.stringify((Array.from as Function).call(undefined, map)));

class Backwards extends Map<string, number> {
  *[Symbol.iterator](): MapIterator<[string, number]> {
    yield* [...super.entries()].reverse();
  }
}
show("a class below Map with an iterator of its own", Array.from(new Backwards(map)));

const withNext = new Map(map);
(withNext as any).next = () => ({ done: true, value: undefined });
show("a Map with a next of its own", Array.from(withNext));

const grown = new Map<number, number>([[0, 0]]);
const seen: number[] = [];
for (const [key] of Array.from(grown)) {
  seen.push(key);
  if (key < 3) grown.set(key + 1, 0);
}
show("the list is made before the loop", [seen, grown.size]);
console.log(lines.join("\n"));
