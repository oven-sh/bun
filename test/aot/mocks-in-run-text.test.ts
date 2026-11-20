import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A test holds code as text and runs it, and the code mocks a module under a path that the text does not spell. The build reads the text: any module may be mocked
// then. A text that only goes into a file which nothing can run opens none. Which texts do is asked of the look through the test files itself:
// a_text_that_is_run_and_mocks_by_a_made_path_may_mock_any_module() in src/aot/load/look_tests.rs. Here: the run goes by that answer.
const code = "`Bun.jest(globalThis.libPath).mock.module(globalThis.libPath, () => ({ answer: () => 'mocked' }))`";
const project = (imports: string, runs: string) => ({
  "package.json": `{ "name": "p", "type": "module" }`,
  "lib.js": `export function answer() { return "real"; }`,
  "a.test.js": `import { test } from "bun:test";
${imports}
globalThis.libPath = import.meta.dir + "/lib.js";
const code = ${code};
test("a", async () => {
  ${runs}
  console.log("SEEN a " + (await import("./lib.js")).answer());
});`,
  // The next test file of the realm mocks nothing.
  "z.test.js": `import { test } from "bun:test";
import { answer } from "./lib.js";
test("z", async () => console.log("SEEN z " + answer() + " " + (await import("./lib.js")).answer()));`,
});

async function printed(dir: string, flags: string[], words: string) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: "1" };
  const { stdout, stderr } = await run([bunExe(), "test", "--parallel=1", "--no-isolate", ...flags], dir, env);
  return (stdout + "\n" + stderr).split("\n");
}
const seen = (lines: string[]) => lines.filter(line => line.startsWith("SEEN"));
// Bun's own library is a build of its own, of hundreds of files.
const mayBeMocked = (lines: string[]) =>
  lines
    .map(line => line.match(/may replace \d+ in (\d+) files \| modules that may be mocked (\d+)/))
    .filter(found => found && Number(found[1]) < 100)
    .reduce((sum, found) => sum + Number(found![2]), 0);

test("an indirect eval runs the text", async () => {
  using dir = tempDir("aot-mocks-in-run-text", project("", `(0, eval)(code);`));
  const plain = seen(await printed(String(dir), [], ""));
  expect(plain[0]).toBe("SEEN a mocked");
  expect(plain.length).toBe(2);
  const one = await printed(String(dir), ["--aot"], "TestRunLayers:0");
  expect(seen(one)).toEqual(plain);
  expect(mayBeMocked(one)).toBeGreaterThan(0);
}, 600000);
