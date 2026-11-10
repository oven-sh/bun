// A test file's read of an import costs the same whether or not a mock may load the imported module again.
//
// Where any file of a test run may be evicted (a test file names vi.resetModules() or Bun.plugin()), a test file reads its imports
// as members of the namespace object, through the property caches. A module that a mock may load again keeps its variables in a
// module instance. The caches answered only for variables among the statics, so each such read took the slow path: about 1,500
// instructions in place of 130.
//
// The test file measures itself with process.cpuUsage(), around the loop alone, so the test needs no counters.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { spawned } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { describe, test } from "./measures";

const files = {
  "package.json": `{ "name": "made-up", "type": "module" }`,
  "dep.mjs": `export const step = 1;`,
  "lib.mjs": `
    import { step } from "./dep.mjs";
    export const base = 7;
    export let total = 0;
    export function add(n) { total += n * step; return total; }
    export function twice(n) { return n * 2; }`,
  "reads.test.mjs": `
    import { test } from "bun:test";
    import { add, twice, total } from "./lib.mjs";
    import * as whole from "./lib.mjs";
    test("reads", () => {
      let sum = 0;
      const start = process.cpuUsage();
      for (let i = 0; i < 500_000; i++) sum += twice(i & 7) + add(1) + total + whole.base;
      const spent = process.cpuUsage(start);
      console.log(JSON.stringify({ sum, milliseconds: (spent.user + spent.system) / 1000 }));
    });`,
  "resets.test.mjs": `
    import { test, vi } from "bun:test";
    test.skip("resets", () => { vi.resetModules(); });`,
};
const mocks = `
  import { test, vi } from "bun:test";
  test.skip("mocks", () => { vi.doMock("./dep.mjs", () => ({ step: 2 })); });`;
const dir = tempDir("aot-import-reads", { evictable: files, reloadable: { ...files, "mocks.test.mjs": mocks } });
afterAll(() => dir[Symbol.dispose]());

describe("a test file's read of an import", () => {
  test("costs the same from a module that a mock may load again", async () => {
    const measure = async (project: "evictable" | "reloadable") => {
      let least = Infinity;
      for (let run = 0; run < 3; run++) {
        const ran = await spawned([bunExe(), "test", "--aot"], join(String(dir), project), bunEnv, 200_000);
        const line = ran.stdout.split("\n").find(line => line.startsWith("{"));
        expect({ line: line !== undefined, exitCode: ran.exitCode }).toEqual({ line: true, exitCode: 0 });
        const { sum, milliseconds } = JSON.parse(line!);
        expect(sum).toBe(250_007_500_000);
        least = Math.min(least, milliseconds);
      }
      return least;
    };
    const [evictable, reloadable] = await Promise.all([measure("evictable"), measure("reloadable")]);
    console.error(
      `READS 2,000,000 reads of imports: ${evictable.toFixed(1)} ms from modules that may be evicted | ${reloadable.toFixed(1)} ms where a mock may load them again`,
    );
    expect(reloadable).toBeLessThan(3 * evictable + 60);
  }, 480_000);
});
