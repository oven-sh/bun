// barrel.js says `export * from "pkg"; export const own = "own"`, barrel2.js says `export * from "./barrel.js"`, and a mock stands in place of barrel.js.
// What barrel2.js hands on is what the mock has: `own`, which the mock lacks, is no key of its namespace object, and `in` does not find it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const packages = {
  "an ES package": {
    "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js", "type": "module" }`,
    "node_modules/pkg/index.js": `export const x = "real x";`,
  },
  "a CommonJS package": {
    "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
    "node_modules/pkg/index.js": `exports.x = "real x";`,
  },
};
const barrels = {
  "one after the other": { barrel: "", barrel2: "" },
  "in a ring": { barrel: `export * from "./barrel2.js";`, barrel2: `export const second = "second";` },
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

const cases = Object.keys(packages).flatMap(from =>
  Object.keys(barrels).flatMap(shape => Object.keys(ways).map(way => [from, shape, way] as const)),
);

test.concurrent.each(cases)(
  "%s, the barrels %s, %s",
  async (from, shape, way) => {
    const { barrel, barrel2 } = barrels[shape as keyof typeof barrels];
    using folder = tempDir("aot-mock-star-keys", {
      "package.json": `{ "name": "mock-star-keys", "type": "module" }`,
      ...packages[from as keyof typeof packages],
      "barrel.js": `export * from "pkg";
export const own = "own";
${barrel}`,
      "barrel2.js": `export * from "./barrel.js";
${barrel2}`,
      "user.js": `import * as all from "./barrel2.js";
const key = JSON.parse('"own"');
export const seen = () => [Object.keys(all).join("+"), "own" in all, key in all, all.own, all[key], all.x, all.extra].join();`,
      "a.test.js": `import { test, vi } from "bun:test";
vi.mock("./barrel.js", () => ({ x: "mock x", extra: "mock extra" }));
import { seen } from "./user.js";
test("a", async () => console.log("OUT", seen(), Object.keys(await import("./barrel2.js")).join("+")));`,
    });
    const dir = String(folder);
    const plain = await run(dir, []);
    expect(plain.exitCode).toBe(0);
    expect(plain.lines.join()).not.toContain("own");
    expect(plain.lines.join()).toContain("mock extra");
    expect(await run(dir, ["--aot"], ways[way as keyof typeof ways])).toEqual(plain);
  },
  240_000,
);
