// The original of a module that was LOADED before it was mocked is the loaded module itself: vi.importActual(), the parameter of a factory and
// jest.requireActual() answer its own function objects and its own `module.exports`, and its body does not run again. A compiled run loaded the file
// once more from disk: the body ran twice, and what it handed out was equal to look at and another object.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "mock-original-loaded", "type": "module" }`,
  "mod.js": `console.log("OUT runs mod");
export const value = "real";
export function fn() { return "real-fn"; }
export { inner as handedOn } from "./inner.js";`,
  "inner.js": `export function inner() { return "inner"; }`,
  "lib.cjs": `console.log("OUT runs lib");
exports.hello = () => "real-hello";`,

  "actual.test.js": `import { mock, test, vi } from "bun:test";
test("vi.importActual()", async () => {
  const mod = await import("./mod.js");
  const { fn, handedOn } = mod;
  mock.module("./mod.js", () => ({ value: "mocked", fn: () => "mocked-fn", handedOn: () => "mocked-inner", added: 1 }));
  const actual = await vi.importActual("./mod.js");
  console.log("OUT", mod.value, mod.fn(), mod.handedOn(), "|", actual.value, actual.fn === fn, actual.handedOn === handedOn, Object.keys(actual).sort().join());
  vi.doUnmock("./mod.js");
  console.log("OUT", mod.value, mod.fn === fn, (await import("./mod.js")) === mod);
});`,
  "parameter.test.js": `import { mock, test } from "bun:test";
test("the parameter of a factory", async () => {
  const mod = await import("./mod.js");
  const { fn } = mod;
  let same;
  await mock.module("./mod.js", async importOriginal => {
    const original = await importOriginal();
    same = original.fn === fn;
    return { ...original, value: "mocked" };
  });
  console.log("OUT", mod.value, same, mod.fn === fn);
});`,
  "second-mock.test.js": `import { mock, test, vi } from "bun:test";
test("behind a second mock the original is still the file's own", async () => {
  const mod = await import("./mod.js");
  const { fn } = mod;
  mock.module("./mod.js", () => ({ fn: () => "first" }));
  mock.module("./mod.js", () => ({ fn: () => "second" }));
  const actual = await vi.importActual("./mod.js");
  console.log("OUT", mod.fn(), actual.fn === fn, actual.value);
});`,
  "commonjs.test.js": `import { jest, mock, test, vi } from "bun:test";
test("a CommonJS file", async () => {
  const lib = import.meta.require("./lib.cjs");
  const { hello } = lib;
  mock.module("./lib.cjs", () => ({ hello: () => "mocked-hello" }));
  const actual = await vi.importActual("./lib.cjs");
  console.log("OUT", import.meta.require("./lib.cjs").hello(), actual.hello === hello, actual.default === lib, jest.requireActual("./lib.cjs") === lib);
});`,
  "required.test.js": `import { jest, mock, test } from "bun:test";
test("jest.requireActual() of an ES module", async () => {
  const mod = await import("./mod.js");
  const { fn } = mod;
  mock.module("./mod.js", () => ({ fn: () => "mocked-fn" }));
  const actual = jest.requireActual("./mod.js");
  console.log("OUT", mod.fn(), actual.fn === fn, actual.value);
});`,
  "never-loaded.test.js": `import { mock, test, vi } from "bun:test";
test("a module that nothing had loaded is loaded for the original", async () => {
  mock.module("./mod.js", () => ({ value: "mocked" }));
  const actual = await vi.importActual("./mod.js");
  console.log("OUT", (await import("./mod.js")).value, actual.value, actual.fn());
});`,
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
  "actual.test.js": [
    "OUT runs mod",
    "OUT mocked mocked-fn mocked-inner | real true true fn,handedOn,value",
    "OUT real true true",
  ],
  "parameter.test.js": ["OUT runs mod", "OUT mocked true true"],
  "commonjs.test.js": ["OUT runs lib", "OUT mocked-hello true true true"],
};

test.concurrent.each(Object.keys(files).filter(name => name.endsWith(".test.js")))(
  "%s",
  async file => {
    using folder = tempDir("aot-mock-original-loaded", files);
    const dir = String(folder);
    const plain = await run(dir, file, []);
    expect(plain.exitCode).toBe(0);
    if (file in pins) expect(plain.lines).toEqual(pins[file as keyof typeof pins]);
    expect(await run(dir, file, ["--aot"], "TestRunLayers:0")).toEqual(plain);
    expect(await run(dir, file, ["--aot"], "TestRunLayers:2")).toEqual(plain);
  },
  240_000,
);
