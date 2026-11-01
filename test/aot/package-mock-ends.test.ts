import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A mock ends with its test file. The next test file shares what the first one loaded, and reads the module itself. Over layers the mocked module lies in a
// lower program than the file that imports it: a package below the files of the project, or one file of the project below another.
const filler = Array.from({ length: 6000 }, (_, i) => `export function filler${i}(x) { return x + ${i}; }\n`).join("");
const importsFiller = `import { filler1 } from "./filler.mjs"; void filler1;\n`;
const factory = `() => ({ default: { f: () => "mocked" }, f: () => "mocked" })`;
const packages = {
  "an ES package": {
    "node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "index.js" }`,
    "node_modules/pkg/index.js": `export const f = () => "real"; export default { f };`,
  },
  "a CommonJS package": {
    "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
    "node_modules/pkg/index.js": `exports.f = () => "real";`,
  },
};
const mocks = {
  "mocked by a hoisted vi.mock()": `import { test, vi } from "bun:test";
import { seen } from "./src/uses.js";
vi.mock("pkg", ${factory});
test("a", () => console.log("SEEN a " + seen()));`,
  "mocked by mock.module() before the load": `import { test, mock } from "bun:test";
mock.module("pkg", ${factory});
const { seen } = await import("./src/uses.js");
test("a", () => console.log("SEEN a " + seen()));`,
};
const shared = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "filler.mjs": filler,
  "src/uses.js": `import it from "pkg";
import * as all from "pkg";
import { f } from "pkg";
export const seen = () => [it.f(), all.f(), f()].join();`,
  "b.test.js": `${importsFiller}import { test } from "bun:test";
import { seen } from "./src/uses.js";
test("b", () => console.log("SEEN b " + seen()));`,
};

async function printed(dir: string, flags: string[], words: string) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr } = await run([bunExe(), "test", "--parallel=1", "--no-isolate", ...flags], dir, env);
  return (stdout + "\n" + stderr).split("\n");
}
const seen = (lines: string[]) => lines.filter(line => line.startsWith("SEEN"));

const cases = Object.keys(packages).flatMap(kind => Object.keys(mocks).map(mock => [kind, mock] as const));
test.each(cases)(
  "%s, %s",
  async (kind, mock) => {
    using dir = tempDir("aot-package-mock-ends", {
      ...shared,
      ...packages[kind as keyof typeof packages],
      "a.test.js": importsFiller + mocks[mock as keyof typeof mocks],
    });
    const plain = seen(await printed(String(dir), [], ""));
    expect(plain).toEqual(["SEEN a mocked,mocked,mocked", "SEEN b real,real,real"]);
    const layers = await printed(String(dir), ["--aot", "--aot-memory-limit", "1MB"], "TestRunSaysItsForm");
    expect(layers.filter(line => line.startsWith("AOT test run |")).join()).toContain("| layers 2 |");
    expect(seen(layers)).toEqual(plain);
    expect(seen(await printed(String(dir), ["--aot"], "TestRunLayers:0"))).toEqual(plain);
  },
  600000,
);

// The require() of the project's file goes through the loader, which keeps an entry of require.cache for the package. The one in the other package is bound by the build.
// The imports have run the package again by then, so no require() does.
test("another package requires it at the call", async () => {
  const requires = `import { f } from "pkg";\nexport const seen = () => f() + "+" + require("pkg").f();`;
  using dir = tempDir("aot-package-mock-ends", {
    ...shared,
    ...packages["an ES package"],
    "node_modules/reads/package.json": `{ "name": "reads", "type": "module", "main": "index.js" }`,
    "node_modules/reads/index.js": requires,
    "src/uses.js": requires,
    "a.test.js": `${importsFiller}import { test, mock } from "bun:test";
mock.module("pkg", ${factory});
const { seen: mine } = await import("./src/uses.js");
const { seen: ofPackage } = await import("reads");
test("a", () => console.log("SEEN a " + mine() + "," + ofPackage()));`,
    "b.test.js": `${importsFiller}import { test } from "bun:test";
import { seen as mine } from "./src/uses.js";
import { seen as ofPackage } from "reads";
test("b", () => console.log("SEEN b " + mine() + "," + ofPackage()));`,
  });
  const plain = seen(await printed(String(dir), [], ""));
  expect(plain).toEqual(["SEEN a mocked+mocked,mocked+mocked", "SEEN b real+real,real+real"]);
  const layers = await printed(String(dir), ["--aot", "--aot-memory-limit", "1MB"], "TestRunSaysItsForm");
  expect(layers.filter(line => line.startsWith("AOT test run |")).join()).toContain("| layers 2 |");
  expect(seen(layers)).toEqual(plain);
  expect(seen(await printed(String(dir), ["--aot"], "TestRunLayers:0"))).toEqual(plain);
}, 600000);

test("a file of the project that lies below its importer", async () => {
  using dir = tempDir("aot-package-mock-ends", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "dep.ts": `export const name = "real";`,
    "src/uses-dep.ts": `import { name } from "../dep"; export const seen = () => name;`,
    "a.test.ts": `import { test, mock } from "bun:test";
test("a", async () => {
  mock.module("./dep", () => ({ name: "mocked" }));
  console.log("SEEN a " + (await import("./src/uses-dep")).seen());
});`,
    "b.test.ts": `import { test } from "bun:test";
test("b", async () => console.log("SEEN b " + (await import("./src/uses-dep")).seen()));`,
  });
  const plain = seen(await printed(String(dir), [], ""));
  expect(plain).toEqual(["SEEN a mocked", "SEEN b real"]);
  expect(seen(await printed(String(dir), ["--aot"], "TestRunLayers:3"))).toEqual(plain);
}, 600000);
