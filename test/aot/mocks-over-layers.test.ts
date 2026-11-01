import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A large test run is built in layers: what the test files import is one program, each group of test files another above it. A small run takes layers by itself
// with --parallel and more source than fits the memory it is given: every test file here imports 300 KB of filler.
const filler = Array.from({ length: 6000 }, (_, i) => `export function filler${i}(x) { return x + ${i}; }\n`).join("");
const importsFiller = `import { filler1 } from "./filler.mjs"; void filler1;\n`;
const setup = (second: string) => `import { vi } from "bun:test";
const wrap = f => {
  if (typeof f !== "function") throw new Error("nothing to wrap: " + typeof f);
  return () => "wrapped " + f();
};
vi.mock("./pkg-a.mjs", async importOriginal => {
  console.log("SEEN factory a");
  const actual = await importOriginal();
  return { ...actual, default: wrap(actual.default) };
});
${second}
vi.mock("./barrel.mjs", async importOriginal => {
  console.log("SEEN factory barrel");
  try {
    const actual = await importOriginal();
    return { ...actual, a: wrap(actual.a), b: wrap(actual.b) };
  } catch (error) {
    console.log("SEEN swallowed: " + error.message);
    return {};
  }
});`;
// The loader has fetched the whole graph of a test file before a body of it runs: a helper that mocks finds what the test file imports beside it loaded.
const helperThatMocks = (second: string) => ({
  "pkg-a.mjs": `console.log("SEEN runs pkg-a"); export default function a() { return "real a"; }`,
  "pkg-b.mjs": `console.log("SEEN runs pkg-b"); export default function b() { return "real b"; }`,
  "barrel.mjs": `console.log("SEEN runs barrel"); export { default as a } from "./pkg-a.mjs"; export { default as b } from "./pkg-b.mjs";`,
  "demo.mjs": `console.log("SEEN runs demo"); import { a, b } from "./barrel.mjs"; export default () => a() + " | " + b();`,
  "setup.mjs": setup(second),
  "a.test.mjs": `import { test } from "bun:test";
import "./setup.mjs";
import demo from "./demo.mjs";
test("t", () => {
  try {
    console.log("SEEN " + demo());
  } catch (error) {
    console.log("SEEN failed: " + error.message);
  }
});`,
});
const stars = {
  "common.cjs": `exports.c = x => x + 2;`,
  "starc.js": `export * from "./common.cjs";`,
  "lib.js": `export function f(x) { return x + 7; }`,
  "barrel.js": `export * from "./lib.js";`,
  "stars.js": `export * from "./starc.js"; export * from "./barrel.js";`,
  "bindings.js": `import { c, f } from "./stars.js"; export const seen = () => [c(1), f(1)].join();`,
};
const projects: Record<string, Record<string, string>> = {
  "a helper mocks two packages and their barrel, and one factory gives nothing": helperThatMocks(
    `vi.mock("./pkg-b.mjs", async importOriginal => { console.log("SEEN factory b"); await importOriginal(); return {}; });`,
  ),
  "each factory gives what it was given": helperThatMocks(
    `vi.mock("./pkg-b.mjs", async importOriginal => { console.log("SEEN factory b"); return { ...(await importOriginal()) }; });`,
  ),
  "one package is not mocked": helperThatMocks(""),
  // No layer holds the file as no attribute asks for it: what `type: "json"` makes of it lies in the layer of its importer.
  "a file that every importer imports with a type": {
    "data.json": `{ "a": "real", "b": 1 }`,
    "note.txt": `real`,
    "uses-json.js": `import data from "./data.json" with { type: "json" }; export const read = () => data;`,
    "uses-text.js": `import text from "./note.txt" with { type: "text" }; export const read = () => text;`,
    "x.test.js": `import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./data.json", async importOriginal => {
    const original = await importOriginal();
    console.log("SEEN factory", JSON.stringify(original.default));
    return { default: [original.default] };
  });
  vi.doMock("./note.txt", () => ({ default: "mocked" }));
  console.log("SEEN", JSON.stringify((await import("./uses-json.js")).read()), (await import("./uses-text.js")).read());
});`,
  },
  // Nothing hoists mock.module(): the barrel has been loaded, and what the factory gives is stored into the variables of the package, which lie in the layer of the packages.
  "a mock laid over a barrel of packages": {
    "node_modules/whole/package.json": `{ "name": "whole", "main": "index.js", "type": "module" }`,
    "node_modules/whole/index.js": `export * from "./inner.js"; export const x = "real x";`,
    "node_modules/whole/inner.js": `export function f() { return "real f"; }`,
    "node_modules/named/package.json": `{ "name": "named", "main": "index.js", "type": "module" }`,
    "node_modules/named/index.js": `export const a = "real a"; export const c = "real c"; export const kept = "real kept";`,
    "barrel.js": `export * from "whole"; export { a as b } from "named"; import { c } from "named"; export { c };`,
    "user.js": `import * as ns from "./barrel.js"; import { x, b, c } from "./barrel.js"; import { x as direct } from "whole"; import { a, kept } from "named";
export const seen = () => [ns.x, ns.f(), ns.b, ns.c, x, b, c, direct, a, kept, Object.keys(ns).sort().join("+")].join();`,
    "x.test.js": `import { mock, test } from "bun:test";
mock.module("./barrel.js", () => ({ x: "mock x", f: () => "mock f", b: "mock b", c: "mock c" }));
import { seen } from "./user.js";
test("t", async () => {
  const ns = await import("./barrel.js");
  console.log("SEEN x", seen(), ns.x, ns.f(), ns.b, ns.c);
});`,
    // The mock ends with its test file: what it stored into the layer of the packages comes back for a file that runs behind it in the same realm.
    "z.test.js": `import { test } from "bun:test";
import { seen } from "./user.js";
test("t", async () => {
  const ns = await import("./barrel.js");
  console.log("SEEN z", seen(), ns.x, ns.f(), ns.b, ns.c);
});`,
  },
  // Over layers the loader holds the text and a layer holds what `type: "json"` makes of the file, which nothing has loaded when the mock comes: no patch reaches it, so none stays behind.
  "a type that nothing has loaded beside one that has": {
    "b.json": `{ "v": "real" }`,
    "lib.mjs": `import text from "./b.json" with { type: "text" };
export const now = () => (String(text).includes("real") ? "TEXT" : String(text));
export const json = async () => (await import("./b.json", { with: { type: "json" } })).default.v;`,
    "a.test.js": `import { mock, test } from "bun:test";
import { now } from "./lib.mjs";
test("a", () => {
  mock.module("./b.json", () => ({ default: { v: "MOCK" } }));
  console.log("SEEN a", now());
});`,
    "b.test.js": `import { test } from "bun:test";
import { json, now } from "./lib.mjs";
test("b", async () => console.log("SEEN b", now(), await json()));`,
  },
  "a spy under a computed name on a star over a CommonJS file": {
    ...stars,
    "x.test.js": `import { spyOn, test } from "bun:test";
import * as starC from "./starc.js";
import * as stars from "./stars.js";
import { c, f } from "./stars.js";
import { seen } from "./bindings.js";
const made = name => name.split("").join("");
test("t", () => {
  console.log("SEEN", f(1), c(1), stars.f(1), Object.keys(stars).join(), seen());
  const spy = spyOn(starC, made("c")).mockImplementation(() => "fake");
  console.log("SEEN", starC.c(1), stars.c(1), c(1), f(1), seen());
  spy.mockRestore();
  const other = spyOn(stars, made("f")).mockImplementation(() => "fake f");
  console.log("SEEN", stars.f(1), f(1), seen());
  other.mockRestore();
  console.log("SEEN", starC.c(1), stars.c(1), c(1), stars.f(1), f(1), seen());
});`,
  },
};

test.each(Object.keys(projects))(
  "%s",
  async name => {
    const files = Object.entries(projects[name]).map(([path, text]) => [
      path,
      /\.test\./.test(path) ? importsFiller + text : text,
    ]);
    using dir = tempDir("aot-mocks-over-layers", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "filler.mjs": filler,
      ...Object.fromEntries(files),
    });
    const printed = async (flags: string[], words: string) => {
      const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words }); // prettier-ignore
      return (stdout + "\n" + stderr).split("\n");
    };
    // Two workers print in any order.
    const seen = (lines: string[]) => lines.filter(line => line.startsWith("SEEN")).sort();
    const plain = seen(await printed(["--parallel=2"], ""));
    expect(plain.length).toBeGreaterThan(0);
    const layers = await printed(["--aot", "--parallel=2", "--aot-memory-limit", "1MB"], "TestRunSaysItsForm");
    expect(layers.filter(line => line.startsWith("AOT test run |")).join()).toContain("| layers 2 |");
    expect(seen(layers)).toEqual(plain);
    expect(seen(await printed(["--aot"], "TestRunLayers:0"))).toEqual(plain);
    expect(seen(await printed(["--aot"], "TestRunLayers:2,TestRunPartFiles:1"))).toEqual(plain);
    // One test file behind another in one realm.
    expect(seen(await printed(["--aot"], "TestRunLayers:2"))).toEqual(plain);
    expect(seen(await printed(["--parallel=1", "--no-isolate"], ""))).toEqual(plain);
    const together = await printed(["--aot", "--parallel=1", "--no-isolate", "--aot-memory-limit", "1MB"], "TestRunSaysItsForm"); // prettier-ignore
    expect(together.filter(line => line.startsWith("AOT test run |")).join()).toContain("| layers 2 |");
    expect(seen(together)).toEqual(plain);
  },
  600000,
);
