// `jest.mock("./lib")` and `vi.mock("./lib")` without a factory replace every function of the module by a mock function. The test runner reads the module's exports for that.
// Of a compiled module that had run it did not take the exports that were there: it loaded the file once more, from disk, in a later turn. So a test that said
// `jest.doMock("./lib")` and called `lib.f()` in its next statement got the real function, and a test file that read a mocked import at its top level, as Jest's own
// examples do (`const memory = new Memory()`, `jest.mocked(sum)`), got the real one, or "Cannot access 'default' before initialization".
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "mock-without-factory" }`,
  "lib.mjs": `console.log("OUT lib.mjs runs");
export let value = "real value";
export function f() { return "real f"; }`,
  "lib.cjs": `console.log("OUT lib.cjs runs");
exports.value = "real value";
exports.f = function () { return "real f"; };`,
  "sum.ts": `export default function sum(a: number, b: number) { return a + b; }`,
  "memory.ts": `export default class Memory { current = 0; add(n: number) { this.current += n; return this.current; } }`,
  "calc.ts": `import type Memory from "./memory";
import sum from "./sum";
export default (memory: Memory) => (a: number) => { const result = sum(a, a); memory.add(result); return result; };`,

  "loaded-mjs.test.mjs": `import { jest, test } from "bun:test";
import * as lib from "./lib.mjs";
test("a module that has run", () => {
  console.log("OUT", lib.f());
  jest.doMock("./lib.mjs");
  console.log("OUT", lib.value, lib.f(), jest.isMockFunction(lib.f));
});`,
  "loaded-cjs.test.mjs": `import { jest, test } from "bun:test";
import * as lib from "./lib.cjs";
test("a CommonJS file that has run", () => {
  console.log("OUT", lib.f());
  jest.doMock("./lib.cjs");
  console.log("OUT", lib.value, lib.f(), jest.isMockFunction(lib.f));
});`,
  "unloaded-mjs.test.mjs": `import { test, vi } from "bun:test";
test("a module that has not run", async () => {
  vi.doMock("./lib.mjs");
  const lib = await import("./lib.mjs");
  console.log("OUT", lib.value, lib.f(), vi.isMockFunction(lib.f));
});`,
  "unloaded-cjs.test.mjs": `import { test, vi } from "bun:test";
test("a CommonJS file that has not run", async () => {
  vi.doMock("./lib.cjs");
  const lib = await import("./lib.cjs");
  console.log("OUT", lib.value, lib.f(), vi.isMockFunction(lib.f));
});`,
  "hoisted-cjs.test.mjs": `import { test, vi } from "bun:test";
import * as lib from "./lib.cjs";
vi.mock("./lib.cjs");
test("its body runs once", () => console.log("OUT", lib.value, lib.f(), vi.isMockFunction(lib.f)));`,
  "top-level.test.ts": `import { jest, test } from "bun:test";
import sum from "./sum";
jest.mock("./sum");
console.log("OUT at the top", jest.isMockFunction(sum));
const mocked = jest.mocked(sum);
test("read at the top level", () => {
  mocked.mockReturnValueOnce(5);
  console.log("OUT", sum(1, 2), sum(1, 2));
});`,
  "class.test.ts": `import { jest, test } from "bun:test";
import make from "./calc";
import Memory from "./memory";
import sum from "./sum";
jest.mock("./memory");
jest.mock("./sum");
const memory = new Memory();
test("a class made at the top level", () => {
  console.log("OUT", make(memory)(2), jest.mocked(sum).mock.calls.length, jest.mocked(memory.add).mock.calls.length);
});`,
  "user.cjs": `const lib = require("./lib.cjs");
exports.seen = () => Object.keys(lib).join() + " " + lib.value + " " + lib.f();`,
  "required-cjs.test.mjs": `import { jest, test } from "bun:test";
import * as lib from "./lib.cjs";
test("what require() answers", async () => {
  console.log("OUT", lib.f());
  jest.doMock("./lib.cjs");
  console.log("OUT", (await import("./user.cjs")).seen());
});`,
  "flat.mjs": `export const a = "real";
export function fn() { return "real fn"; }`,
  "flat-user.mjs": `import { a, fn } from "./flat.mjs";
export const seen = () => JSON.stringify([a, fn()]);`,
  "ring.mjs": `import "./ring-user.mjs";
export const a = "real";
export function fn() { return "real fn"; }`,
  "ring-user.mjs": `import { a, fn } from "./ring.mjs";
export const seen = () => JSON.stringify([a, fn()]);`,
  "after-factory.test.mjs": `import { jest, test, vi } from "bun:test";
test("behind a mock with a factory, seen from an importer that has run", () => {
  jest.doMock("./flat.mjs", () => ({ a: "mocked", fn: () => 1 }));
  console.log("OUT", require("./flat-user.mjs").seen());
  vi.doMock("./flat.mjs");
  console.log("OUT", require("./flat-user.mjs").seen());
});`,
  "after-factory-ring.test.mjs": `import { jest, test, vi } from "bun:test";
test("the same where the two import each other", () => {
  jest.doMock("./ring.mjs", () => ({ a: "mocked", fn: () => 1 }));
  console.log("OUT", require("./ring-user.mjs").seen());
  vi.doMock("./ring.mjs");
  console.log("OUT", require("./ring-user.mjs").seen());
});`,
  "after-factory-itself.test.mjs": `import { jest, test, vi } from "bun:test";
test("the module itself", () => {
  jest.doMock("./flat.mjs", () => ({ a: "mocked", fn: () => 1 }));
  console.log("OUT", require("./flat.mjs").a);
  vi.resetModules();
  vi.doMock("./flat.mjs");
  console.log("OUT", require("./flat.mjs").a);
});`,
  "second-factory.test.mjs": `import { jest, test, vi } from "bun:test";
test("a second factory by vi.doMock()", () => {
  jest.doMock("./flat.mjs", () => ({ a: "first", fn: () => 1 }));
  console.log("OUT", require("./flat-user.mjs").seen());
  vi.doMock("./flat.mjs", () => ({ a: "second", fn: () => 2 }));
  console.log("OUT", require("./flat-user.mjs").seen());
});`,
  "spy.test.mjs": `import { test, vi } from "bun:test";
import * as lib from "./lib.mjs";
vi.mock("./lib.mjs", { spy: true });
test("functions that are watched and still run", () => console.log("OUT", lib.value, lib.f(), lib.f.mock.calls.length));`,
};

async function run(dir: string, file: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "./" + file],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

const pins = {
  "loaded-mjs.test.mjs": ["OUT lib.mjs runs", "OUT real f", "OUT real value undefined true"],
  "loaded-cjs.test.mjs": ["OUT lib.cjs runs", "OUT real f", "OUT real value undefined true"],
  "unloaded-mjs.test.mjs": ["OUT lib.mjs runs", "OUT real value undefined true"],
  "unloaded-cjs.test.mjs": ["OUT lib.cjs runs", "OUT real value undefined true"],
  "hoisted-cjs.test.mjs": ["OUT lib.cjs runs", "OUT real value undefined true"],
  "top-level.test.ts": ["OUT at the top true", "OUT 5 undefined"],
  "class.test.ts": ["OUT undefined 1 1"],
  "required-cjs.test.mjs": ["OUT lib.cjs runs", "OUT real f", "OUT value,f real value undefined"],
  "after-factory.test.mjs": ['OUT ["mocked",1]', 'OUT ["real",null]'],
  "after-factory-ring.test.mjs": ['OUT ["mocked",1]', 'OUT ["real",null]'],
  "after-factory-itself.test.mjs": ["OUT mocked", "OUT real"],
  "second-factory.test.mjs": ['OUT ["first",1]', 'OUT ["second",2]'],
  "spy.test.mjs": ["OUT lib.mjs runs", "OUT real value real f 1"],
};

test.concurrent.each(Object.keys(pins) as (keyof typeof pins)[])(
  "%s",
  async file => {
    using folder = tempDir("aot-mock-without-factory", files);
    const dir = String(folder);
    const plain = await run(dir, file, []);
    expect(plain).toEqual({ lines: pins[file], exitCode: 0 });
    expect(await run(dir, file, ["--aot"], "TestRunLayers:0")).toEqual(plain);
    expect(await run(dir, file, ["--aot"], "TestRunLayers:2")).toEqual(plain);
  },
  240_000,
);
