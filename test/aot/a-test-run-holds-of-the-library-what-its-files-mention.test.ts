// A test run compiles what an executable compiles: of Bun's library it holds what its files mention. A file that only registers tests and compares values mentions next to nothing of it.
// What can run code that no build has seen says so by its own words, and holds what such code may find.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

async function functionsInTheImage(testFile: string) {
  using dir = tempDir("aot-library-of-a-test-run", { "package.json": `{ "type": "module" }`, "a.test.ts": testFile });
  const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), env);
  expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const [, count] = (stdout + "\n" + stderr).match(/^AOT size of the image: \| functions emitted (\d+) /m) ?? [];
  return Number(count);
}

const small = `import { afterEach, beforeAll, describe, expect, test } from "bun:test";
let seen = 0;
beforeAll(() => { seen = 1; });
afterEach(() => { seen++; });
describe("a suite", () => {
  test("compares", () => { expect(seen).toBe(1); expect({ a: [1, new Map([[1, 2]])] }).toEqual({ a: [1, new Map([[1, 2]])] }); });
  test.skip("is skipped", () => {});
  test.each([1, 2])("takes %i", value => { expect(value).toBeGreaterThan(0); });
});
`;

test("a file that registers tests and compares values", async () => {
  expect(await functionsInTheImage(small)).toBeLessThan(100);
}, 120_000);

test("a file that evaluates text holds what the text may find", async () => {
  const evaluates = small + `test("evaluates", () => { expect((0, eval)("1 + 1")).toBe(2); });\n`;
  expect(await functionsInTheImage(evaluates)).toBeGreaterThan(400);
}, 120_000);
