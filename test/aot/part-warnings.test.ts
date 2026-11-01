import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const project = {
  "package.json": `{}`,
  "src/shared.ts": `export interface Shape { side: number }
export const area = (shape: Shape): number => shape.side * shape.side;
export const caller = function shared(): unknown { return shared.caller; };`,
  "tests/one.test.ts": `import { expect, test } from "bun:test";
import { area, caller, type Shape } from "../src/shared";
const own = function inTestFile(): unknown { return inTestFile.caller; };
test("one", () => {
  const shape: Shape = { side: 2 };
  expect(area(shape)).toBe(4);
  expect([typeof caller, typeof own]).toEqual(["function", "function"]);
});`,
  "tests/two.test.ts": `import { expect, test } from "bun:test";
import { area } from "../src/shared";
test("two", () => expect(area({ side: 3 })).toBe(9));`,
};

const warnings = (stderr: string) =>
  [...stderr.matchAll(/^warn: (.*)\n(?:.*\n)*?\s+at .*?([^/]+:\d+):\d+$/gm)]
    .map(match => `${match[2]} ${match[1]}`)
    .sort();

test.concurrent.each([
  ["as one program", "TestRunLayers:0"],
  ["in layers", "TestRunLayers:2,TestRunPartFiles:1"],
])("the build's warnings about a test file are shown, %s", async (_, words) => {
  using dir = tempDir("part-warnings", project);
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), env);
  expect(warnings(stderr)).toEqual([
    "one.test.ts:3 TS100302: 'caller' is always null on a compiled function.",
    "shared.ts:3 TS100302: 'caller' is always null on a compiled function.",
  ]);
  expect(exitCode).toBe(0);
});
