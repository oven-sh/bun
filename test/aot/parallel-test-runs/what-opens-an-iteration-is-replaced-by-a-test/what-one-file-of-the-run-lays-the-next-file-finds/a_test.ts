import { test } from "bun:test";
import * as roads from "./roads";
import { set, walkSet } from "./app";
test("the first file replaces what opens a set and leaves it there", () => {
  console.log("first file, as built:", walkSet(set(), -1, () => {}));
  (globalThis as any).originalOpenOfSets = roads.put(roads.aboveSets, roads.symbolNamed("iter", "ator"), function* () { yield 6; });
  console.log("first file, laid:", walkSet(set(), -1, () => {}));
});
