import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `delete require.cache[require.resolve("./file.cjs")]; require("./file.cjs")`: in a test run the file loads again from disk, as code that the build has not seen.
// That copy calls `note()`, which the test file has laid on the global object. As one program the build saw only its own calls of `note`, all of them direct, and closed the entry
// that everybody else comes in by: "This function was left out of the executable, because nothing seemed to refer to it. This is a bug in Bun."
const files: Record<string, string> = {
  "package.json": `{}`,
  "file.cjs": `note("the file runs");
exports.made = new Made(3).value;
exports.read = shared.count;
`,
  "a.test.cjs": `const { test } = require("bun:test");
const log = [];
globalThis.note = text => log.push(text);
globalThis.Made = class { constructor(value) { this.value = value * 2; } };
globalThis.shared = { get count() { return log.length; } };
const say = (name, run) => { try { console.log(name, JSON.stringify(run()), log.join()); } catch (error) { console.log(name, "throws", error.message.slice(0, 70)); } log.length = 0; };
test("a file that is taken out of require.cache calls what stands on the global object", () => {
  say("first", () => require("./file.cjs"));
  delete require.cache[require.resolve("./file.cjs")];
  say("again", () => require("./file.cjs"));
});
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

// Alone in its run: beside a file that lets code run which no build has seen, the entry stays open anyway.
test("a file that loads again from disk calls what the test file has laid on the global object, as one program", async () => {
  using dir = tempDir("aot-copy-of-a-file-reads-the-global-object", files);
  const plain = await runTests(String(dir), undefined);
  expect(plain).toEqual({
    stdout: [`first {"made":6,"read":1} the file runs`, `again {"made":6,"read":1} the file runs`],
    exitCode: 0,
  });
  expect(await runTests(String(dir), "TestRunLayers:0", "--aot")).toEqual(plain);
}, 180_000);
