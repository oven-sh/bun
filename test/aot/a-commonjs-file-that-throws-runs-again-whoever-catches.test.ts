import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A CommonJS file whose body throws is out of require.cache, and the next require() runs it again.
// The build has to know that the program goes on behind the throw. It knew `try { require(..) } catch {}` and a function handed to something called `expect`.
// Whoever is handed a function may catch what it throws: a helper of the project, assert.throws(), a promise, the test runner itself.
const thrower = (name: string) => `
  note("${name} runs");
  if (globalThis.throws) throw new Error("thrown by ${name}");
  exports.value = 1;`;

const head = `
  const { test } = require("bun:test");
  const log = [];
  globalThis.note = text => log.push(text);
  const show = (name, answer) => { console.log(name, JSON.stringify(answer), log.join()); log.length = 0; };`;

const files: Record<string, string> = {
  "package.json": `{}`,
  "src/by-a-helper.cjs": thrower("by-a-helper"),
  "src/by-assert.cjs": thrower("by-assert"),
  "src/by-a-promise.cjs": thrower("by-a-promise"),
  "src/by-a-function-called-at-once.cjs": thrower("by-a-function-called-at-once"),
  "src/by-the-runner.cjs": thrower("by-the-runner"),

  "a-helper.test.cjs": `${head}
    const attempt = ask => { try { return ask(); } catch (error) { return error.message; } };
    test("a helper of the project catches", () => {
      globalThis.throws = true;
      show("first", attempt(() => require("./src/by-a-helper.cjs")));
      globalThis.throws = false;
      show("again", attempt(() => require("./src/by-a-helper.cjs")));
      show("a third time", attempt(() => require("./src/by-a-helper.cjs")));
    });`,
  "assert.test.cjs": `${head}
    const assert = require("node:assert");
    test("assert.throws() catches", () => {
      globalThis.throws = true;
      assert.throws(() => require("./src/by-assert.cjs"), /thrown by/);
      show("first", "caught");
      globalThis.throws = false;
      show("again", require("./src/by-assert.cjs"));
    });`,
  "a-promise.test.cjs": `${head}
    test("a promise catches", async () => {
      globalThis.throws = true;
      show("first", await new Promise(resolve => resolve(require("./src/by-a-promise.cjs"))).catch(error => error.message));
      globalThis.throws = false;
      show("again", await new Promise(resolve => resolve(require("./src/by-a-promise.cjs"))).catch(error => error.message));
    });`,
  "called-at-once.test.cjs": `${head}
    test("what stands around a function that is called at once catches", () => {
      globalThis.throws = true;
      try { show("first", (() => require("./src/by-a-function-called-at-once.cjs"))()); } catch (error) { show("first", error.message); }
      globalThis.throws = false;
      show("again", (() => require("./src/by-a-function-called-at-once.cjs"))());
    });`,
  "the-runner.test.cjs": `${head}
    test.failing("the runner catches", () => {
      globalThis.throws = true;
      require("./src/by-the-runner.cjs");
    });
    test("and the next test asks again", () => {
      show("first", "caught");
      globalThis.throws = false;
      show("again", require("./src/by-the-runner.cjs"));
    });`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test(`a CommonJS file that throws runs again, whoever has caught what it threw, ${way}`, async () => {
    using dir = tempDir("aot-a-commonjs-file-that-throws-runs-again", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toContain(`again {"value":1} by-a-helper runs`);
    expect(plain.stdout).toContain(`a third time {"value":1} `);
    expect(plain.stdout).toContain(`again {"value":1} by-assert runs`);
    expect(plain.stdout).toContain(`again {"value":1} by-a-promise runs`);
    expect(plain.stdout).toContain(`again {"value":1} by-a-function-called-at-once runs`);
    expect(plain.stdout).toContain(`again {"value":1} by-the-runner runs`);
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);
}
