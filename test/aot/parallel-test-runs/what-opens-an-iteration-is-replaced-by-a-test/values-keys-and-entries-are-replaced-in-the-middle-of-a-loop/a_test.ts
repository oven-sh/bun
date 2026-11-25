import { test } from "bun:test";
import * as roads from "./roads";
import { list, map, set, walkEntries, walkEntriesOfList, walkKeys, walkValues, walkValuesOfSet } from "./app";
test("the methods that make iterators are replaced while a loop over what they make runs", () => {
  const singles = function () { return [5, 6][Symbol.iterator](); };
  const pairs = function () { return [["p", 5]][Symbol.iterator](); };
  for (const [what, above, parts, walk, make, laid] of [["values of a map", roads.aboveMaps, ["val", "ues"], walkValues, map, singles], ["keys of a map", roads.aboveMaps, ["ke", "ys"], walkKeys, map, singles],
    ["entries of a map", roads.aboveMaps, ["ent", "ries"], walkEntries, map, pairs], ["values of a set", roads.aboveSets, ["val", "ues"], walkValuesOfSet, set, singles], ["entries of a list", roads.aboveLists, ["ent", "ries"], walkEntriesOfList, list, pairs]] as any[]) {
    const name = roads.named(...parts);
    console.log(what, "as built:", walk(make(), -1, () => {}));
    let original: unknown;
    console.log(what, "replaced at the second turn:", walk(make(), 1, () => { original = roads.put(above, name, laid); }));
    console.log(what, "replaced:", walk(make(), -1, () => {}));
    console.log(what, "put back at the first turn:", walk(make(), 0, () => { roads.put(above, name, original); }));
    console.log(what, "put back:", walk(make(), -1, () => {}));
  }
});
