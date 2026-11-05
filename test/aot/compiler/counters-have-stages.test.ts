// A build with --explain=statistics prints every counter of statistics.def, and measure.ts gives each a stage.
// A counter that the compiler gains belongs in that list. This test alone says so, by the counter's name; the others go on reading the counters that they know.
import { expect } from "bun:test";
import { tempDir } from "harness";
import { buildFlags } from "../harness/flags";
import { test } from "../supported";
import { build, countersWithoutAStage } from "./measure";

test("every counter that the compiler prints has its stage in measure.ts", async () => {
  using folder = tempDir("aot-counters-have-stages", { "main.js": "console.log(1);\n" });
  const { stderr } = await build({ folder: String(folder), entry: "main.js" }, [buildFlags.withoutExecutable]);
  expect(countersWithoutAStage(stderr)).toEqual([]);
});
