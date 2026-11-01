import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const files = {
  "package.json": `{ "name": "import-meta-resolve-of-a-name-that-only-a-mock-has" }`,
  "bunfig.toml": `[test]\npreload = ["./preload.cjs"]\n`,
  "preload.cjs": `const { mock } = require("bun:test"); mock.module("made-up", () => ({ v: "mocked" }));`,
  "node_modules/real/package.json": `{ "name": "real", "main": "./index.js" }`,
  "node_modules/real/index.js": `module.exports = { v: "real" };`,
  "src/helper.mjs": `export const resolveHere = name => import.meta.resolve(name); export const resolveMock = () => import.meta.resolve("made-up");`,
  "resolve.test.mjs": `
    import { test, mock } from "bun:test";
    import { resolveHere, resolveMock } from "./src/helper.mjs";
    const say = (label, f) => {
      try { console.log(label, String(f()).replaceAll(import.meta.dir, ".")); } catch (e) { console.log(label, e.constructor.name, e.code); }
    };
    test("names", async () => {
      say("a mock of the preload", () => import.meta.resolve("made-up"));
      say("in a file of the project", resolveMock);
      say("by a name that is handed in", () => resolveHere("made-up"));
      mock.module("made-here", () => ({ v: 1 }));
      say("a mock of the test", () => import.meta.resolve("made-here"));
      say("nothing", () => import.meta.resolve("nothing-at-all"));
      say("a package", () => import.meta.resolve("real"));
      mock.module("real", () => ({ v: "mock of real" }));
      say("a package that is mocked", () => import.meta.resolve("real"));
      say("a file", () => import.meta.resolve("./src/helper.mjs"));
      say("a module of Bun", () => import.meta.resolve("node:fs"));
      say("require.resolve", () => require.resolve("made-up"));
      say("resolveSync", () => import.meta.resolveSync("made-up"));
      console.log("loads", (await import("made-up")).v, (await import("real")).v);
    });`,
};

async function printedBy(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.replace(/^bun test .*\n/, ""), exitCode };
}

test.each([
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
])("%s", async (_, words) => {
  using directory = tempDir("import-meta-resolve-of-a-name-that-only-a-mock-has", files);
  const plain = await printedBy(String(directory), words);
  expect(plain.printed).toContain("a mock of the preload ResolveMessage ERR_MODULE_NOT_FOUND");
  expect(plain.printed).toContain("loads mocked mock of real");
  expect(await printedBy(String(directory), words, "--aot")).toEqual(plain);
});
