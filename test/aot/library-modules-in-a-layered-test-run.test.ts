import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test --aot` in layers: Bun's own modules are in the lowest program, and the files of the project and the test files in programs above it.
// Every way to ask for `node:path` answers with the one object, in each of them, so that a spy put on it in a test file is seen by the project.
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "tsconfig.json": "{}",
  "src/app.mjs": `import path from "node:path";
import * as pathSpace from "node:path";
import fs from "fs";
import { readFileSync } from "node:fs";
import os from "node:os";
export const held = { path, pathSpace, fs, readFileSync, os };
export const read = () => fs.existsSync("/");
export const named = () => readFileSync;`,
  "src/app.cjs": `const hidden = text => JSON.parse(JSON.stringify(text));
exports.held = { path: require("path"), nodePath: require("node:path"), fs: require("fs"), os: require("os") };
exports.byName = name => require(hidden(name));
exports.resolved = name => require(require.resolve(name));
exports.builtin = name => process.getBuiltinModule(name);`,
  "library.test.js": `import { test, spyOn } from "bun:test";
import path from "node:path";
import fs from "node:fs";
import * as fsSpace from "node:fs";
import { held as esm, read } from "./src/app.mjs";
import cjs from "./src/app.cjs";
const hidden = text => JSON.parse(JSON.stringify(text));
test("one instance of a library module", async () => {
  console.log("path", esm.path === path, cjs.held.path === path, cjs.held.nodePath === path, require("path") === path, require("node:path") === path, require(hidden("node:path")) === path, require(hidden("path")) === path);
  console.log("path by name in the app", cjs.byName("path") === path, cjs.byName("node:path") === path, cjs.resolved("path") === path, cjs.resolved("node:path") === path);
  console.log("path by import()", (await import("node:path")).default === path, (await import(hidden("node:path"))).default === path, (await import(hidden("path"))).default === path);
  console.log("resolve", require.resolve("node:path"), require.resolve("path"), require.resolve("fs"), import.meta.resolve("node:fs"));
  console.log("getBuiltinModule", typeof process.getBuiltinModule("module"), process.getBuiltinModule("path") === path, process.getBuiltinModule("node:path") === path, typeof cjs.builtin("module"), cjs.builtin("node:fs") === fs, typeof cjs.builtin("node:module")?.createRequire);
  console.log("fs", esm.fs === fs, cjs.held.fs === fs, require(hidden("fs")) === fs, cjs.byName("node:fs") === fs, fsSpace.default === fs);
  console.log("os", esm.os === cjs.held.os, require("os") === esm.os, require(hidden("node:os")) === esm.os);
  const spy = spyOn(fs, "existsSync").mockReturnValue("mocked");
  console.log("a spy", read(), cjs.held.fs.existsSync("/"), require(hidden("fs")).existsSync("/"), spy.mock.calls.length);
  spy.mockRestore();
});`,
  "builtin.test.js": `import { test } from "bun:test";
import path from "node:path";
const hidden = text => JSON.parse(JSON.stringify(text));
test("getBuiltinModule in a test file", () => {
  console.log("literal", typeof process.getBuiltinModule("path"), typeof process.getBuiltinModule("node:path"), typeof process.getBuiltinModule("module"), typeof process.getBuiltinModule("node:zlib"));
  console.log("hidden", typeof process.getBuiltinModule(hidden("path")), typeof process.getBuiltinModule(hidden("node:path")), typeof process.getBuiltinModule(hidden("module")), process.getBuiltinModule(hidden("path")) === path);
  const get = process.getBuiltinModule;
  console.log("held", typeof get("path"), typeof get.call(process, "node:os"), typeof process["getBuiltinModule"]("node:os"));
  console.log("missing", process.getBuiltinModule("nothing-of-the-kind"), process.getBuiltinModule(hidden("./src/app.cjs")), process.getBuiltinModule("bun:test") === undefined);
});`,
};
// A run of a few test files is one program.
for (let i = 0; i < 16; i++)
  files[`more-${i}.test.js`] = `import { test } from "bun:test";\ntest("one of many, ${i}", () => {});`;

async function runTests(directory: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  return { stdout: printed.sort(), results: results.sort(), exitCode };
}

test("a library module is one object for every layer", async () => {
  using dir = tempDir("aot-library-modules-in-layers", files);
  const plain = await runTests(String(dir));
  expect(plain.results.length).toBe(18);
  expect(plain.stdout).toContain("literal object object function object");
  expect(plain.stdout).toContain("a spy mocked mocked mocked 3");
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}, 120_000);
