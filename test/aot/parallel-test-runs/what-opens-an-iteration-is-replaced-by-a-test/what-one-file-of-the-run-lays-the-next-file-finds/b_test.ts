import { test } from "bun:test";
import * as roads from "./roads";
import { set, walkSet } from "./app";
test("the second file finds what the first has laid, or a world of its own, as `bun test` has it", () => {
  console.log("second file:", walkSet(set(), -1, () => {}));
  if ((globalThis as any).originalOpenOfSets) roads.put(roads.aboveSets, roads.symbolNamed("iter", "ator"), (globalThis as any).originalOpenOfSets);
  console.log("second file, put back:", walkSet(set(), -1, () => {}));
});
