import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// The eager entries of import.meta.glob() are imports like any other: a hoisted mock goes above them.
const projects: Record<string, Record<string, string>> = {
  "namespaces, one name of each, and a lazy entry": {
    "dependency.ts": `export const dependency = "real";`,
    "glob.test.ts": `import { test, vi } from "bun:test";
const namespaces = import.meta.glob("./modules/*.ts", { eager: true }) as any;
const named = import.meta.glob("./modules/*.ts", { eager: true, import: "a" });
const lazy = import.meta.glob("./modules/*.ts", { import: "default" }) as any;
vi.mock("./dependency.ts", () => ({ dependency: "mocked" }));
test("glob", async () => { console.log("SAY", namespaces["./modules/a.ts"].a, "|", JSON.stringify(named), "|", await lazy["./modules/b.ts"]()); });`,
    "modules/a.ts": `import { dependency } from "../dependency.ts"; export const a = "a " + dependency; export default a;`,
    "modules/b.ts": `import { dependency } from "../dependency.ts"; export const a = "b " + dependency; export default a;`,
  },
  "the eager entries alone": {
    "dependency.ts": `export const dependency = "real";`,
    "glob.test.ts": `import { test, vi } from "bun:test";
const namespaces = import.meta.glob("./modules/*.ts", { eager: true }) as any;
vi.mock("./dependency.ts", () => ({ dependency: "mocked" }));
test("glob", () => { console.log("SAY", namespaces["./modules/a.ts"].a); });`,
    "modules/a.ts": `import { dependency } from "../dependency.ts"; export const a = "a " + dependency; export default a;`,
  },
  "the mock is written first": {
    "dependency.ts": `export const dependency = "real";`,
    "glob.test.ts": `import { test, vi } from "bun:test";
vi.mock("./dependency.ts", () => ({ dependency: "mocked" }));
const namespaces = import.meta.glob("./modules/*.ts", { eager: true }) as any;
test("glob", () => { console.log("SAY", namespaces["./modules/a.ts"].a); });`,
    "modules/a.ts": `import { dependency } from "../dependency.ts"; export const a = "a " + dependency; export default a;`,
  },
  "a mock of an entry itself": {
    "glob.test.ts": `import { test, vi } from "bun:test";
const namespaces = import.meta.glob("./modules/*.ts", { eager: true }) as any;
vi.mock("./modules/a.ts", () => ({ a: "mocked a" }));
test("glob", () => { console.log("SAY", namespaces["./modules/a.ts"].a); });`,
    "modules/a.ts": `export const a = "real a";`,
  },
  "the order of the entries among written imports": {
    "first.ts": `((globalThis as any).events ??= []).push("first");`,
    "glob.test.ts": `import "./first.ts";
import.meta.glob("./modules/*.ts", { eager: true });
import "./last.ts";
vi.mock("./nothing.ts", () => ({}));
test("order", () => console.log("SAY", JSON.stringify((globalThis as any).events)));`,
    "last.ts": `((globalThis as any).events ??= []).push("last");`,
    "modules/a.ts": `((globalThis as any).events ??= []).push("a");`,
    "modules/b.ts": `((globalThis as any).events ??= []).push("b");`,
  },
  "jest.mock": {
    "dependency.ts": `export const dependency = "real";`,
    "glob.test.ts": `import { test, jest } from "bun:test";
const namespaces = import.meta.glob("./modules/*.ts", { eager: true }) as any;
jest.mock("./dependency.ts", () => ({ dependency: "mocked" }));
test("glob", () => { console.log("SAY", namespaces["./modules/a.ts"].a); });`,
    "modules/a.ts": `import { dependency } from "../dependency.ts"; export const a = "a " + dependency; export default a;`,
  },
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:8" }],
];

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  return { printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), results, exitCode };
}

for (const [name, files] of Object.entries(projects)) {
  for (const [way, env] of ways) {
    test.concurrent(`${name}, ${way}`, async () => {
      using dir = tempDir("mock-glob", { "package.json": `{}`, ...files });
      const plain = await runTests(String(dir), {});
      expect(plain.exitCode).toBe(0);
      expect(plain.printed.length).toBeGreaterThan(0);
      expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
    });
  }
}

const counted = (glob: string) => ({
  "package.json": `{}`,
  "modules/a.ts": `export const a = 1;`,
  "modules/b.ts": `export const a = 2;`,
  "glob.ts": `export const keys = Object.keys(${glob});
export function covered() { return 1; }
export function thrower() {
  throw new Error("thrown");
}
export function never() { return 2; }`,
  "positions.test.ts": `import * as glob from "./glob.ts";
test("positions", () => { glob.covered(); try { glob.thrower(); } catch {} });`,
});

test.concurrent.each([
  `import.meta.glob("./modules/*.ts")`,
  `import.meta.glob("./modules/*.ts", { eager: true })`,
  `import.meta.glob("./modules/*.ts", { import: "a" })`,
  `import.meta.glob("./modules/*.ts", { import: "a", eager: true })`,
])("what %s is turned into is in no coverage report", async glob => {
  using dir = tempDir("mock-glob-coverage", counted(glob));
  const report = async (...flags: string[]) => {
    const { stderr, stdout } = await run([bunExe(), "test", "--coverage", ...flags], String(dir), bunEnv);
    return (stderr + stdout).split("\n").filter(line => /^\s*(All files|glob\.ts|modules\/)/.test(line));
  };
  const plain = await report();
  expect(plain.length).toBeGreaterThan(1);
  expect(await report("--aot")).toEqual(plain);
});
