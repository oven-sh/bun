import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

// A test run looks through its files for the members of built-in objects that tests replace, and takes an object beside a name for one: `stub(Array.prototype, "join")`.
// That is a guess at what a test means. A file that takes nothing from bun:test is the program's own, and an executable holds it too: there Object.prototype.toString
// is locked whatever table names it, and `list.join()` is compiled for a list whose members are as built. So it is in the layer that the test files stand on.
// The layers are built as `bun test --aot` builds them, with and without the table, and the compiler's map says which operations a function is made of.
const table = `
  export const hardened = [
    [Object.prototype, ["toString", "valueOf", "toLocaleString"]],
    [Array.prototype, ["toString", "join"]],
    [Function.prototype, ["toString"]],
  ];
  export function describe(lock: (holder: object, name: string) => string) {
    return hardened.flatMap(([holder, names]) => (names as string[]).map(name => lock(holder as object, name))).length;
  }`;
const files = (hasTable: boolean) => ({
  "src/table.ts": hasTable
    ? table
    : `export function describe(lock: (holder: object, name: string) => string) { return lock({}, "none").length + 2; }`,
  "src/lists.ts": `
    export function joins(list: number[]) { return list.join("-"); }
    export function grows(list: number[], more: number) { list.push(more); return String(list); }
    export function writes(value: { at: number[] }) { return JSON.stringify(value); }`,
  // A helper lies in the folder of a test file or below it, whatever it imports. No build sees the code that this one holds as a string, so the guess is all there is.
  "test/helpers/planter.ts": `
    export function planter() {
      return \`
        const planted = [[Object.prototype, "planted"]];
        export function plant() { for (const [holder, name] of planted) Object.defineProperty(holder, name, { value: 1, configurable: true }); }
        export function uproot() { for (const [holder, name] of planted) delete holder[name]; }
      \`;
    }`,
  "test/a.test.ts": `
    import { expect, test } from "bun:test";
    import { writeFileSync } from "node:fs";
    import { join } from "node:path";
    import { describe } from "../src/table.ts";
    import { grows, joins, writes } from "../src/lists.ts";
    import { planter } from "./helpers/planter.ts";
    test("a", async () => {
      expect(describe((holder, name) => name)).toBe(6);
      expect(joins([1, 2])).toBe("1-2");
      expect(grows([1], 2)).toBe("1,2");
      expect(writes({ at: [1] })).toBe('{"at":[1]}');
      const written = join(import.meta.dir, "written.mjs");
      writeFileSync(written, planter());
      const { plant, uproot } = await import(written);
      plant();
      expect(({} as { planted?: number }).planted).toBe(1);
      uproot();
      expect(({} as { planted?: number }).planted).toBe(undefined);
    });`,
});
const env = {
  ...bunEnv,
  BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1",
  BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1",
};

async function operationsOfLists(hasTable: boolean) {
  using dir = tempDir("aot-a-table-of-built-ins-unlocks-nothing", files(hasTable));
  const at = (name: string) => join(String(dir), name);
  const build = async (graph: string, part: string, below: number[], more: Record<string, string>) => {
    writeFileSync(at(graph), at("test/a.test.ts") + "\0");
    const descriptor = openSync(at(graph), "r+");
    try {
      await using builder = Bun.spawn({
        cmd: [bunExe(), "test", "--aot", "--isolate", `--aot-build-test-part=${part}`],
        cwd: String(dir),
        env: { ...env, ...more },
        stdio: ["ignore", "pipe", "pipe", descriptor, ...below],
      });
      const [stderr, exitCode] = await Promise.all([builder.stderr.text(), builder.exited]);
      expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    } finally {
      closeSync(descriptor);
    }
  };
  await build("packages", "3,shared,packages", [], {});
  const packages = openSync(at("packages"), "r");
  try {
    await build("shared", "3,shared,below:4", [packages], { BUN_JSC_aotMapFilePath: at("map") });
  } finally {
    closeSync(packages);
  }
  const lines = readFileSync(at("map"), "utf8").split("\n");
  const found: string[] = [];
  lines.forEach((line, index) => {
    const [kind, , , , , , , name, variant] = line.split("\t");
    if (kind !== "F" || !name || !line.includes("lists.ts")) return;
    const names = lines[index + 1].split("\t").filter(word => /^[A-Z][A-Za-z.]+\/?\d*\+?$/.test(word) && word !== "O");
    found.push(`${name} ${variant}: ${names.join(" ")}`);
  });
  return found.sort();
}

test("the functions beside the table are made of what they are made of without it", async () => {
  const [withTable, without] = await Promise.all([operationsOfLists(true), operationsOfLists(false)]);
  expect(without.length).toBeGreaterThan(2);
  expect(withTable).toEqual(without);
}, 240_000);

test("the run passes", async () => {
  using dir = tempDir("aot-a-table-of-built-ins-unlocks-nothing-run", files(true));
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", "--aot", "--isolate"],
    cwd: String(dir),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
}, 120_000);
