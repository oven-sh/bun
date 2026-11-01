import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// `jest.mock("./src/old.cjs")` beside src/__mocks__/old.cjs, and the first load of the module is a require(): it gets the file of the folder at once.
// An import waits for that file, which may await at its top; a require() of such a file is refused, as in `bun test`.
const files = {
  "package.json": `{ "name": "mock-folder-require" }`,
  "src/old.cjs": `exports.who = "real old";`,
  "src/__mocks__/old.cjs": `exports.who = "manual old";`,
  "src/above.cjs": `exports.who = "above " + require("./old.cjs").who;`,
  "src/esm.mjs": `export const who = "real esm";`,
  "src/__mocks__/esm.mjs": `export const who = "manual esm";`,
  "src/waits.mjs": `export const who = "real waits";`,
  "src/__mocks__/waits.mjs": `console.error("SEEN the file of the folder begins");
await new Promise(resolve => setTimeout(resolve, 5));
console.error("SEEN the file of the folder ends");
export const who = "manual waits";`,
  "src/never.mjs": `export const who = "real never";`,
  // It never goes on, so that nothing is printed behind the refusal, early or late.
  "src/__mocks__/never.mjs": `console.error("SEEN the file of the folder begins");
await new Promise(() => {});
export const who = "manual never";`,
  "meta.test.ts": `
import { jest, test } from "bun:test";
jest.mock("./src/old.cjs");
test("import.meta.require()", async () =>
  console.error("SEEN", import.meta.require("./src/old.cjs").who, "|", (await import("./src/old.cjs")).who));`,
  "written.test.ts": `
import { jest, test } from "bun:test";
jest.mock("./src/old.cjs");
test("a written require()", () => console.error("SEEN", require("./src/old.cjs").who));`,
  "below.test.ts": `
import { jest, test } from "bun:test";
jest.mock("./src/old.cjs");
test("below what is required", () => console.error("SEEN", require("./src/above.cjs").who));`,
  "esm.test.ts": `
import { jest, test } from "bun:test";
jest.mock("./src/esm.mjs");
test("an ES module", async () =>
  console.error("SEEN", import.meta.require("./src/esm.mjs").who, "|", require("./src/esm.mjs").who, "|", (await import("./src/esm.mjs")).who));`,
  "waits-require.test.ts": `
import { jest, test } from "bun:test";
jest.mock("./src/never.mjs");
test("a require() of a file that awaits", () => {
  try {
    console.error("SEEN", require("./src/never.mjs").who);
  } catch (error: any) {
    console.error("SEEN threw", error.constructor.name, String(error.message).replace(/".*"/, "<path>"));
  }
});`,
  "waits-import.test.ts": `
import { jest, test } from "bun:test";
jest.mock("./src/waits.mjs");
test("an import() of a file that awaits", async () => console.error("SEEN", (await import("./src/waits.mjs")).who));`,
};

test.each(Object.keys(files).filter(name => name.endsWith(".test.ts")))("%s", async name => {
  using dir = tempDir("mock-folder-require", files);
  const seenWith = async (env: Record<string, string>, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "./" + name], String(dir), {
      ...bunEnv,
      ...env,
    });
    return { seen: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
  };
  const [plain, oneProgram, oneLayer, layers] = await Promise.all([
    seenWith({}),
    seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }, "--aot"),
    seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:1" }, "--aot"),
    seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }, "--aot"),
  ]);
  expect(plain.seen.join("\n")).not.toContain("real");
  expect(plain.seen).not.toEqual([]);
  expect(plain.exitCode).toBe(0);
  expect(oneProgram).toEqual(plain);
  expect(oneLayer).toEqual(plain);
  expect(layers).toEqual(plain);
});
