import { test } from "bun:test";
import * as roads from "./roads";
// One file hands the holder above all objects on by its name. Its `constructor` leads to Object, and Object.getPrototypeOf is the road by which the same file reaches the holders above maps and sets.
// That road stays as built, so what is written at its end, under names that are made in the run, is followed as it is where nothing is handed on by name.
const reads = (map: Map<number, number>) => map.get(1);
const walks = (set: Set<number>) => { let sum = 0; for (const each of set) sum += each; return sum; };
test("methods above maps and sets are replaced beside the holder above all objects", () => {
  const map = new Map([[1, 5]]), set = new Set([1, 2]);
  console.log("as built:", reads(map), walks(set), typeof roads.aboveAll.hasOwnProperty);
  const get = roads.put(roads.aboveMaps, roads.named("g", "et"), function () { return 77; });
  const walk = roads.put(roads.aboveSets, roads.symbolNamed("iter", "ator"), function* () { yield 40; });
  console.log("replaced:", reads(map), walks(set));
  roads.put(roads.aboveMaps, roads.named("g", "et"), get);
  roads.put(roads.aboveSets, roads.symbolNamed("iter", "ator"), walk);
  console.log("put back:", reads(map), walks(set));
});
