// `vi.mock("./lib", { spy: true })` replaces every function of the module by a mock function that still runs it. The test runner reads the module's exports for that, under a key of
// its own, and a compiled run refused the key: "Cannot load '..?actual&spy'".
// What else a mock without a factory once got wrong stands in ./fixed-runs: closed/automock-* and open/automock-behind-a-factory-and-a-reset. This case is silent beside others.
// The methods of a class are replaced too, also where the prototype has a Symbol.toStringTag of its own or from a base class such as Map. The mocked module itself runs
// from source, under that key. The classes that barrel.mjs hands on are compiled: there the test runner has to know a class of the project from one of Bun's, and its
// prototype gets its members late. What vi.mockObject() does with such a class stands in ./fixed-runs/closed/spy-in-place-on-classes-with-a-tag.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "mock-without-factory" }`,
  "lib.mjs": `console.log("OUT lib.mjs runs");
export let value = "real value";
export function f() { return "real f"; }
export class Tagged { get [Symbol.toStringTag]() { return "Tagged"; } hello() { return "real hello"; } }
export class Store extends Map { hello() { return "real hello"; } }`,
  "classes.mjs": `export class Tagged { get [Symbol.toStringTag]() { return "Tagged"; } hello() { return "real hello"; } }
export class Store extends Map { hello() { return "real hello"; } }`,
  "barrel.mjs": `export * from "./classes.mjs";`,
  "spy.test.mjs": `import { test, vi } from "bun:test";
import * as lib from "./lib.mjs";
import * as barrel from "./barrel.mjs";
vi.mock("./lib.mjs", { spy: true });
vi.mock("./barrel.mjs", { spy: true });
test("functions that are watched and still run", () => console.log("OUT", lib.value, lib.f(), lib.f.mock.calls.length));
test("methods that are watched and still run", () => {
  const tagged = new lib.Tagged(), store = new lib.Store([["key", 1]]);
  console.log("OUT", tagged.hello(), lib.Tagged.prototype.hello.mock.calls.length, store.get("key"), lib.Store.prototype.get.mock.calls.length);
});
test("methods of the classes that a barrel hands on", () => {
  const tagged = new barrel.Tagged(), store = new barrel.Store([["key", 1]]);
  console.log("OUT barrel", tagged.hello(), barrel.Tagged.prototype.hello.mock.calls.length, store.get("key"), barrel.Store.prototype.get.mock.calls.length);
});`,
};

async function run(dir: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "./spy.test.mjs"],
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
  expect(plain).toEqual({
    lines: ["OUT lib.mjs runs", "OUT real value real f 1", "OUT real hello 1 1 1", "OUT barrel real hello 1 1 1"],
    exitCode: 0,
  });
  expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
}, 240_000);
