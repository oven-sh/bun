import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The compiler cannot hold a file that is nested this deeply. Plain `bun test` loses to it the test that loads it, and a compiled run must lose no more.
const depth = 30_000;
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "helpers/deep.js": `export const count = ${"(".repeat(depth)}1${")".repeat(depth)};\n`,
  "helpers/fine.js": `export const fine = 1;\n`,
  "deep.test.js": `import { expect, test } from "bun:test";
import { fine } from "./helpers/fine.js";
test("the file is loaded where a test asks for it", async () => {
  let said;
  try { said = (await import("./helpers/deep.js")).count; } catch (error) { said = error.name; }
  console.log("SEEN deep | " + said + " " + fine);
  expect(1).toBe(1);
});
`,
  "other.test.js": `import { expect, test } from "bun:test";
import { fine } from "./helpers/fine.js";
test("a file that has nothing to do with it", () => {
  console.log("SEEN other | " + fine);
  expect(1).toBe(1);
});
`,
};

async function seenIn(words: string | undefined, ...flags: string[]) {
  using dir = tempDir("aot-file-nested-too-deeply", files);
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
  const seen = stdout.split("\n").filter(line => line.startsWith("SEEN "));
  return { seen: seen.sort(), exitCode };
}

test("a file that is nested too deeply is left to the loader", async () => {
  const [plain, one, layers] = await Promise.all([
    seenIn(undefined),
    seenIn("TestRunLayers:0", "--aot"),
    seenIn("TestRunLayers:2,TestRunPartFiles:1", "--aot"),
  ]);
  expect(plain).toEqual({ seen: ["SEEN deep | BuildMessage 1", "SEEN other | 1"], exitCode: 0 });
  expect(one).toEqual(plain);
  expect(layers).toEqual(plain);
}, 240_000);
