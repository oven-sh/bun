import { test, expect, mock } from "bun:test";
import * as all from "./barrel.mjs";
import named, { count, bump, Box, legacy, arrow, leafName } from "./counter.mjs";
import { atLoad, after } from "./late.mjs";

test("live bindings, classes, cycles and barrels of files above a mocked file", async () => {
  console.log("start", count, legacy, atLoad, after, all.early, leafName);
  console.log("bump", bump(), count, all.count, legacy, all.legacy);
  console.log("cycle", all.bumpThroughCycle(), count, all.describe(), all.shapes.describe(), arrow());
  console.log("class", new Box(1).who(), new all.Box(2).who(), Box.made, Box === all.Box);
  console.log("default", named(), all.named(), all.default === undefined, Object.keys(all).join());
  mock.module("./leaf.mjs", () => ({ who: "mock", hits: -1, hit: () => "mocked hit" }));
  console.log("mocked", named(), new Box(3).who(), leafName, all.leafName);
  const again = await import("./counter.mjs");
  console.log("again", again.count, again === (await import("./counter.mjs")), again.bump(), count);
  mock.restore();
});
