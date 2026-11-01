// A library that a bundler made waits one job so that its importer may set it up. Under `bun test --aot` the job ran before the body of the test file that imports the library:
// the library started with its defaults and no listeners. The file counted as the face of a CommonJS file, because its first request is a require of what `__commonJS` wraps.
// The same in executables: parallel/modules/a-bundled-library-hears-its-importer-before-its-first-job and its neighbours.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

const library = `
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_defaults = __commonJS(function(exports, module) {
  module.exports = { level: "default" };
});
var defaults = require_defaults();
var level = defaults.level;
var listeners = [];
function configure(value) { level = value; }
function onReady(f) { listeners.push(f); }
queueMicrotask(() => {
  console.log("SAID the library starts with", level, "and", listeners.length, "listeners");
  for (const f of listeners) f();
});
export { configure, onReady };
`;
const testFile = `
import { configure, onReady } from "./library.mjs";
import { test } from "bun:test";
configure("what the test file asked for");
onReady(() => console.log("SAID the test file hears ready"));
console.log("SAID the body of the test file");
test("x", () => {});
`;

test("the body of the test file runs before the library's first job", async () => {
  using dir = tempDir("a-test-file-sets-up-a-bundled-library", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "library.mjs": library,
    "a.test.mjs": testFile,
  });
  const said = async (words: string | undefined, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
      ...bunEnv,
      BUN_DEBUG_TEST_AOT_WORDS: words,
    });
    expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return stdout.split("\n").filter(line => line.startsWith("SAID"));
  };
  const plain = await said(undefined);
  expect(plain).toEqual([
    "SAID the body of the test file",
    "SAID the library starts with what the test file asked for and 1 listeners",
    "SAID the test file hears ready",
  ]);
  expect(await said("TestRunLayers:0", "--aot")).toEqual(plain);
  expect(await said("TestRunLayers:3,TestRunPartFiles:1", "--aot", "--isolate")).toEqual(plain);
});
