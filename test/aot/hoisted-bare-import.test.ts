import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A run in layers shows no warning of its builds yet, so only the run as one program can fail here.
test.concurrent.each([
  ["plain", [], ""],
  ["as one program", ["--aot"], "TestRunLayers:0"],
  ["over two layers", ["--aot"], "TestRunLayers:2,TestRunPartFiles:1"],
])("an import without names below a hoisted mock is found: %s", async (_, flags, words) => {
  using directory = tempDir("aot-hoisted-bare-import", {
    "knob.ts": `export const knob = 1;`,
    "server.ts": `console.log("SAID server runs"); export {};`,
    "a.test.ts": `
      import { test, vi } from "bun:test";
      vi.mock("./knob.ts", () => ({ knob: 2 }));
      import "./server.ts";
      test("loaded", () => console.log("SAID test"));`,
  });
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(directory), env);
  expect((stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SAID "))).toEqual([
    "SAID server runs",
    "SAID test",
  ]);
  expect(stderr).not.toContain("TS2307");
});
