// `vi.mock("./lib", { spy: true })` replaces every function of the module by a mock function that still runs it. The test runner reads the module's exports for that, under a key of
// its own, and a compiled run refused the key: "Cannot load '..?actual&spy'".
// What else a mock without a factory once got wrong stands in ./fixed-runs: closed/automock-* and open/automock-behind-a-factory-and-a-reset. This case is silent beside others.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "mock-without-factory" }`,
  "lib.mjs": `console.log("OUT lib.mjs runs");
export let value = "real value";
export function f() { return "real f"; }`,
  "spy.test.mjs": `import { test, vi } from "bun:test";
import * as lib from "./lib.mjs";
vi.mock("./lib.mjs", { spy: true });
test("functions that are watched and still run", () => console.log("OUT", lib.value, lib.f(), lib.f.mock.calls.length));`,
};

async function run(dir: string, flags: string[], words = "", file = "./spy.test.mjs") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, file],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test("spy.test.mjs", async () => {
  using folder = tempDir("aot-mock-without-factory", files);
  const dir = String(folder);
  const plain = await run(dir, []);
  expect(plain).toEqual({ lines: ["OUT lib.mjs runs", "OUT real value real f 1"], exitCode: 0 });
  expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
}, 240_000);

// With `{ spy: true }` an instance of a mocked class gets a mock of its own for each method that the class defines itself, and none for a method of a base class.
// Which those are is read off the class when it is mocked: a compiled class, and in a compiled run also the class of a module that has run when it is mocked.
const instanceFiles = {
  "package.json": `{ "name": "mock-without-factory-instances" }`,
  "classes.mjs": `export class Base { inherited() {} }
export class Klass extends Base { method() {} }`,
  "loaded.mjs": `export class Base { inherited() {} }
export class Klass extends Base { method() {} }`,
  "instances.test.mjs": `import { test, vi } from "bun:test";
import { Klass } from "./classes.mjs";
import { Klass as Loaded } from "./loaded.mjs";
test("the mocks that an instance has of its own", async () => {
  const Mocked = vi.mockObject(Klass);
  const spied = vi.mockObject({ Klass }, { spy: true });
  console.log("OUT", Object.keys(new Mocked()).join(), Object.keys(new spied.Klass()).join());
  vi.doMock("./loaded.mjs", { spy: true });
  const mocked = await import("./loaded.mjs");
  console.log("OUT loaded", mocked.Klass !== Loaded, Object.keys(new mocked.Klass()).join());
});`,
};

test("instances.test.mjs", async () => {
  using folder = tempDir("aot-mock-without-factory-instances", instanceFiles);
  const dir = String(folder);
  const plain = await run(dir, [], "", "./instances.test.mjs");
  expect(plain).toEqual({ lines: ["OUT method,inherited method", "OUT loaded true method"], exitCode: 0 });
  expect(await run(dir, ["--aot"], "TestRunLayers:0", "./instances.test.mjs")).toEqual(plain);
}, 240_000);
