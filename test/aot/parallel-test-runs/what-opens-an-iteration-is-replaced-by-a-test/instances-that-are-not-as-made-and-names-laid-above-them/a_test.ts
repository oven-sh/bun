import { test } from "bun:test";
import * as roads from "./roads";
import { map, set, spreadSet, walkMap, walkSet, walkValues } from "./app";
class Odd extends Set<number> { *[Symbol.iterator](): any { yield 40; } }
class Plain extends Set<number> {}
test("a set with a method of its own, sets of classes below, and a name that has nothing to do with iteration", () => {
  const key = roads.symbolNamed("iter", "ator");
  const own = set();
  roads.put(own, key, function* () { yield 30; });
  console.log("own method:", walkSet(own, -1, () => {}), spreadSet(own));
  console.log("classes below:", walkSet(new Odd([1]), -1, () => {}), walkSet(new Plain([1, 2]), -1, () => {}), spreadSet(new Odd([1])), spreadSet(new Plain([1, 2])));
  const turned = set();
  Object.setPrototypeOf(turned, { [Symbol.iterator]: function* () { yield 20; } });
  console.log("another prototype:", walkSet(turned, -1, () => {}));
  roads.put(roads.aboveSets, roads.named("no", "thing"), 1);
  console.log("a name laid above sets:", walkSet(set(), -1, () => {}), spreadSet(set()), walkMap(map(), -1, () => {}), walkValues(map(), -1, () => {}));
  roads.drop(roads.aboveSets, roads.named("no", "thing"));
  console.log("taken away:", walkSet(set(), -1, () => {}), spreadSet(set()));
  const growing = set();
  console.log("it grows and shrinks under the loop:", walkSet(growing, 1, () => { growing.delete(3); growing.add(9); }), walkSet(growing, 0, () => { growing.clear(); growing.add(1); }));
});
