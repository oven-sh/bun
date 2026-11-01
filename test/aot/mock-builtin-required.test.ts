// `bun test`'s loader holds no built-in module that only require() has asked for, so a mock of one waits: its factory runs at the next import or require(). A compiled
// run took the library's module for loaded and ran the factory at once: a factory that nobody asked for was called, and one that awaits importOriginal() failed with
// `ENOENT reading "node:path"`, after which the real module answered.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "mock-builtin-required" }`,
  "reader.cjs": `const it = require("node:child_process"); exports.read = () => typeof it.spawn;`,
  "a-original.test.mjs": `import { test, vi } from "bun:test";
import reader from "./reader.cjs";
test("the factory awaits the original", async () => {
  vi.doMock("node:child_process", async importOriginal => ({ ...(await importOriginal()).default, spawn: () => "mine" }));
  const mocked = await import("node:child_process");
  console.log("OUT", mocked.spawn(), typeof mocked.execSync, reader.read());
});`,
  "b-held.test.js": `import { test, vi } from "bun:test";
test("what was required before stays", async () => {
  const held = require("node:path");
  vi.doMock("node:path", async importOriginal => ({ ...(await importOriginal()).default, join: () => "mine" }));
  const mocked = await import("node:path");
  console.log("OUT", mocked.join("a", "b"), held.join("a", "b"), require("node:path").join("a", "b"), typeof mocked.basename);
});`,
  "c-next.test.js": `import { test } from "bun:test";
test("the next file", async () => {
  console.log("OUT", (await import("node:path")).join("a", "b"), require("node:path").join("a", "b"));
});`,
  "d-lazy.test.js": `import { jest, mock, test, vi } from "bun:test";
test("a factory that nobody asks for is not called", () => {
  require("node:url");
  require("node:os");
  require("node:util");
  const calls = [];
  vi.doMock("node:url", () => (calls.push("vi.doMock"), {}));
  mock.module("node:os", () => (calls.push("mock.module"), {}));
  jest.doMock("node:util", () => (calls.push("jest.doMock"), {}));
  console.log("OUT", calls.length);
  require("node:os");
  console.log("OUT", calls.join());
});`,
  "e-imported.test.js": `import { mock, test } from "bun:test";
import { join } from "node:path";
test("a statement's binding follows a mock that is laid later", () => {
  mock.module("node:path", () => ({ join: () => "mine" }));
  console.log("OUT", join("a", "b"));
});`,
};

async function run(dir: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test("waits for the next load, as one program and over layers", async () => {
  using folder = tempDir("aot-mock-builtin-required", files);
  const dir = String(folder);
  const plain = await run(dir, []);
  expect(plain).toEqual({
    lines: [
      "OUT mine function function",
      "OUT mine a/b mine function",
      "OUT a/b a/b",
      "OUT 0",
      "OUT mock.module",
      "OUT mine",
    ],
    exitCode: 0,
  });
  expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await run(dir, ["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 240_000);
