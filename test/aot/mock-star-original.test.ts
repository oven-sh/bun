// barrel.js says `export * from "./leaf.cjs"; export const own = "own"`. It has run when a mock is laid over it. Its original, as vi.importActual(), the parameter of a
// factory and jest.requireActual() hand it out, has the names behind the star too, with the values that the mock replaced: Vitest's partial mock spreads it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const sources = {
  "an ES file": "./leaf.js",
  "a CommonJS file": "./leaf.cjs",
  "a CommonJS package": "pkg",
  "an ES package": "espkg",
};
const ways = { "as one program": "TestRunLayers:0", "over two layers": "TestRunLayers:2" };

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

const cases = Object.keys(sources).flatMap(source => Object.keys(ways).map(way => [source, way] as const));

test.concurrent.each(cases)(
  "the names of %s, %s",
  async (source, way) => {
    using folder = tempDir("aot-mock-star-original", {
      "package.json": `{ "name": "mock-star-original", "type": "module" }`,
      "leaf.js": `export const x = "real x"; export const y = "real y";`,
      "leaf.cjs": `exports.x = "real x"; exports.y = "real y";`,
      "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
      "node_modules/pkg/index.js": `exports.x = "real x"; exports.y = "real y";`,
      "node_modules/espkg/package.json": `{ "name": "espkg", "main": "index.js", "type": "module" }`,
      "node_modules/espkg/index.js": `export const x = "real x"; export const y = "real y";`,
      "barrel.js": `export * from "${sources[source as keyof typeof sources]}";
export const own = "own";`,
      "a.test.js": `import { jest, mock, test, vi } from "bun:test";
import * as all from "./barrel.js";
const show = it => [it.x, it.y, it.own, it.added, Object.keys(it).sort().join("+")].join();
test("a", async () => {
  mock.module("./barrel.js", () => ({ x: "mock x", own: "mock own", added: "added" }));
  console.log("OUT actual", show(await vi.importActual("./barrel.js")));
  console.log("OUT required", show(jest.requireActual("./barrel.js")));
  await mock.module("./barrel.js", async original => ({ ...(await original()), y: "partly y" }));
  console.log("OUT own", all.own);
});`,
    });
    const dir = String(folder);
    const plain = await run(dir, []);
    expect(plain).toEqual({
      lines: ["OUT actual real x,real y,own,,own+x+y", "OUT required real x,real y,own,,own+x+y", "OUT own own"],
      exitCode: 0,
    });
    expect(await run(dir, ["--aot"], ways[way as keyof typeof ways])).toEqual(plain);
  },
  240_000,
);
