// Native code that reads a whole map or set walks its table: Array.from, the methods of sets that take another set, structuredClone, the constructors, Object.fromEntries, a deep comparison. It changes nothing that a program can see, whatever the keys are and however many: as in plain Bun, and a validating build has nothing to find.
// Flags: --aot-validate
import { isDeepStrictEqual } from "node:util";
const objects = Array.from({ length: 300 }, (_, index) => ({ id: index }));
const symbols = Array.from({ length: 300 }, (_, index) => Symbol("s" + index));
const kinds = {
  strings: index => "k" + index,
  integers: index => index,
  doubles: index => index + 0.5,
  objects: index => objects[index],
  symbols: index => symbols[index],
  bigints: index => BigInt(index),
  mixed: index => (index === 0 ? undefined : index === 1 ? null : ["k" + index, index, index + 0.5, objects[index], symbols[index], BigInt(index)][index % 6]),
};
function readSet(set) {
  const before = [...set];
  const answers = [Array.from(set).length, Array.from(set.values()).length, new Set(set).size, set.union(new Set([-1])).size, set.intersection(set).size, set.difference(new Set()).size, set.isSubsetOf(set), new Set(set).isSupersetOf(set), isDeepStrictEqual(set, new Set(set))];
  const after = [...set];
  return answers.join() + " " + (before.length === after.length && before.every((value, index) => Object.is(value, after[index])));
}
function readMap(map, canBeCloned) {
  const before = [...map.keys()];
  const answers = [Array.from(map).length, Array.from(map.keys()).length, Array.from(map.values()).length, new Map(map).size, canBeCloned ? structuredClone(map).size : "-", isDeepStrictEqual(map, new Map(map)), Map.groupBy(map, () => 1).get(1)?.length];
  const after = [...map.keys()];
  return answers.join() + " " + (before.length === after.length && before.every((value, index) => Object.is(value, after[index])));
}
for (const kind in kinds) {
  for (const count of [0, 1, 5, 9, 255]) {
    const set = new Set(), map = new Map();
    for (let index = 0; index < count; index++) { set.add(kinds[kind](index)); map.set(kinds[kind](index), index); }
    console.log(kind, count, readSet(set), readMap(map, kind !== "symbols" && kind !== "mixed"));
    if (count < 5) continue;
    set.delete(kinds[kind](2)); map.delete(kinds[kind](2));
    console.log(kind, count, "with one deleted", readSet(set), readMap(map, kind !== "symbols" && kind !== "mixed"));
  }
}
