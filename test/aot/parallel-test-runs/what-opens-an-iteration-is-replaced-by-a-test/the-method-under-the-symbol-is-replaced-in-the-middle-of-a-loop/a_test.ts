import { test } from "bun:test";
import * as roads from "./roads";
import { firstTwo, map, set, spreadSet, walkAnything, walkMap, walkSet } from "./app";
test("what stands under Symbol.iterator is replaced while a loop runs", () => {
  const key = roads.symbolNamed("iter", "ator");
  const other = function* () { yield 7; yield 8; };
  const pairs = function* () { yield ["x", 9]; };
  for (const [name, above, walk, make, laid] of [["set", roads.aboveSets, walkSet, set, other], ["map", roads.aboveMaps, walkMap, map, pairs]] as any[]) {
    console.log(name, "as built:", walk(make(), -1, () => {}), walkAnything(make(), -1, () => {}), walk(make(), -1, () => {}, 1));
    let original: unknown;
    console.log(name, "replaced at the second turn:", walk(make(), 1, () => { original = roads.put(above, key, laid); }));
    console.log(name, "replaced:", walk(make(), -1, () => {}), walkAnything(make(), -1, () => {}), walk(make(), -1, () => {}, 0));
    console.log(name, "put back at the first turn:", walk(make(), 0, () => { roads.put(above, key, original); }));
    console.log(name, "put back:", walk(make(), -1, () => {}), walkAnything(make(), -1, () => {}));
  }
  console.log("spread and pattern, as built:", spreadSet(set()), firstTwo(set()));
  const original = roads.put(roads.aboveSets, key, other);
  console.log("spread and pattern, replaced:", spreadSet(set()), firstTwo(set()));
  roads.put(roads.aboveSets, key, original);
  console.log("spread and pattern, put back:", spreadSet(set()), firstTwo(set()));
});
