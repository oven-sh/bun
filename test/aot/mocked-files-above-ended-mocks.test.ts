import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const mockLib = `mock.module("./lib.cjs", () => ({ live: "mock", read: () => "mock" }));`;
const mockBase = `mock.module("./base.mjs", () => ({ x: 1000 }));`;
const use = `console.log("SAID mocked", lib.read(), lib.live, require("./lib.cjs").live);`;

test("a test file imports under its mock a file that an earlier one loaded", async () => {
  using directory = tempDir("mocked-files-above-ended-mocks", {
    "package.json": `{ "name": "p" }`,
    "base.mjs": `export const x = 1;`,
    "lib.cjs": `const base = require("./base.mjs");
globalThis.runs = (globalThis.runs ?? 0) + 1;
module.exports = { live: "live " + globalThis.runs, read() { return module.exports.live + " " + base.x; } };`,
    "a.test.ts": `import { test } from "bun:test";
import * as lib from "./lib.cjs";
test("loads", () => { console.log("SAID first", lib.read()); });`,
    "b.test.ts": `import { mock, test } from "bun:test";
import * as lib from "./lib.cjs";
test("mocks", async () => { ${mockLib} console.log("SAID mocked", (await import("./lib.cjs")).read()); });
test("mocks what it requires", () => { ${mockBase} });`,
    "c.test.ts": `import { test } from "bun:test";
import * as lib from "./lib.cjs";
test("next", () => { console.log("SAID next", lib.read()); });`,
  });
  const names = ["./a.test.ts", "./b.test.ts", "./c.test.ts"];
  const plain = await run([bunExe(), "test", ...names], String(directory), bunEnv);
  const { stdout, stderr } = await run([bunExe(), "test", "--aot", ...names], String(directory), bunEnv);
  const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID "));
  expect(said(plain.stdout)).toEqual(["SAID first live 1 1", "SAID mocked mock", "SAID next live 2 1"]);
  expect(said(stdout)).toEqual(said(plain.stdout));
  expect(stdout + stderr).toContain(" 4 pass");
});

// bun test evicts a mocked CommonJS file with a module that it required. The next test file runs it again.
test.each([
  ["the file before what it requires", [mockLib, mockBase], "./base.mjs"],
  ["the file after what it requires", [mockBase, mockLib], "./base.mjs"],
  ["the file, and it is used before its base is mocked", [mockLib, use, mockBase], "./base.mjs"],
  ["the file, and it is used after its base is mocked", [mockLib, mockBase, use], "./base.mjs"],
  ["the file twice", [mockLib, mockBase, mockLib], "./base.mjs"],
  ["a file above one that requires the base", [mockLib, mockBase], "./middle.cjs"],
] as const)("a test file mocks %s", async (_, steps, required) => {
  using directory = tempDir("mocked-files-above-ended-mocks", {
    "package.json": `{ "name": "p" }`,
    "base.mjs": `export const x = 1;`,
    "middle.cjs": `module.exports = require("./base.mjs");`,
    "lib.cjs": `const base = require("${required}");
globalThis.runs = (globalThis.runs ?? 0) + 1;
console.log("SAID run", globalThis.runs);
let count = 0;
module.exports = { live: "live " + globalThis.runs, read() { return module.exports.live + " " + base.x + " " + ++count; } };`,
    "a.test.ts": `import { mock, test } from "bun:test";
const lib = await import("./lib.cjs");
console.log("SAID first", lib.read());
${steps.map((step, index) => `test("${index}", () => { ${step} });`).join("\n")}`,
    "b.test.ts": `import { test } from "bun:test";
const lib = require("./lib.cjs");
test("next", () => { console.log("SAID next", lib.read(), lib.live, lib === require("./lib.cjs")); });`,
  });
  const names = ["./a.test.ts", "./b.test.ts"];
  const plain = await run([bunExe(), "test", ...names], String(directory), bunEnv);
  const { stdout, stderr } = await run([bunExe(), "test", "--aot", ...names], String(directory), bunEnv);
  const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID "));
  expect(said(plain.stdout)).toContain("SAID next live 2 1 1 live 2 true");
  expect(said(stdout)).toEqual(said(plain.stdout));
  expect(stdout + stderr).toContain(` ${steps.length + 1} pass`);
});
