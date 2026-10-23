import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const options = {
  target: "ESNext",
  module: "Preserve",
  moduleResolution: "bundler",
  noEmit: true,
  types: [] as string[],
  strict: true,
};
const config = (paths?: object) => JSON.stringify({ compilerOptions: { ...options, ...(paths && { paths }) } });

async function run(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const errors = (said: string) =>
  [...said.matchAll(/^error: (TS\d+):.*\n +at .*paths-of-the-tsconfigs-above[^\\/]*[\\/](.+):(\d+):\d+$/gm)]
    .map(match => `${match[2]!.replaceAll("\\", "/")}:${match[3]} ${match[1]}`)
    .sort();

const atTheRoot = {
  "src/value.ts": `export const value: number = 1;\nexport type Value = number;\n`,
  "root.test.ts": `import { expect, test } from "bun:test";\nimport { value } from "core/value";\ntest("root", () => {\n  expect(value).toBe(1);\n});\n`,
};

test("a name that the nearest tsconfig.json leads elsewhere is not found by the paths of a neighbor's tsconfig.json", async () => {
  using dir = tempDir("paths-of-the-tsconfigs-above", {
    ...atTheRoot,
    "tsconfig.json": config({ "core/*": ["./src/*"] }),
    "packages/one/tsconfig.json": config({ "core/*": ["../../not-built/*"] }),
    "packages/one/one.test.ts": `import { expect, test } from "bun:test";\nimport { value } from "core/value";\ntest("one", () => {\n  expect(value).toBe(1);\n});\n`,
  });
  const plain = await run(String(dir), "test");
  expect(passed(plain.said)).toEqual(["root"]);
  const alone = await run(String(dir), "test", "--aot", "./packages/one/one.test.ts");
  expect(errors(alone.said)).toEqual(["packages/one/one.test.ts:2 TS100150"]);
  const together = await run(String(dir), "test", "--aot");
  expect(errors(together.said)).toEqual(["packages/one/one.test.ts:2 TS100150"]);
  expect(passed(together.said)).toEqual(["root"]);
}, 60_000);

const importsOnlyType = `import { expect, test } from "bun:test";\nimport type { Value } from "core/value";\nconst two: Value = 2;\ntest("two", () => {\n  expect(two).toBe(2);\n});\n`;

// What the nearest tsconfig.json cannot resolve for a type, the program's own is asked: a build reports no error that `bun check` at the program's root does not.
// The program is the project of the first file of the run.
test("a type imported by a name that only a tsconfig.json further up knows is found beside a test file up there, and not alone", async () => {
  using dir = tempDir("paths-of-the-tsconfigs-above", {
    ...atTheRoot,
    "tsconfig.json": config({ "core/*": ["./src/*"] }),
    "packages/two/tsconfig.json": config({ "helpers/*": ["./helpers/*"] }),
    "packages/two/two.test.ts": importsOnlyType,
  });
  const plain = await run(String(dir), "test");
  expect(passed(plain.said)).toEqual(["root", "two"]);
  const alone = await run(String(dir), "test", "--aot", "./packages/two/two.test.ts");
  expect(errors(alone.said)).toEqual(["packages/two/two.test.ts:2 TS2307"]);
  expect(passed(alone.said)).toEqual([]);
  const together = await run(String(dir), "test", "--aot");
  expect(errors(together.said)).toEqual([]);
  expect(passed(together.said)).toEqual(["root", "two"]);
}, 60_000);

test("a type imported by a name that the nearest tsconfig.json inherits through extends is found, alone and beside a test file up there", async () => {
  using dir = tempDir("paths-of-the-tsconfigs-above", {
    ...atTheRoot,
    "tsconfig.json": config({ "core/*": ["./src/*"] }),
    "packages/two/tsconfig.json": JSON.stringify({ extends: "../../tsconfig.json" }),
    "packages/two/two.test.ts": importsOnlyType,
  });
  const alone = await run(String(dir), "test", "--aot", "./packages/two/two.test.ts");
  expect(errors(alone.said)).toEqual([]);
  expect(passed(alone.said)).toEqual(["two"]);
  const together = await run(String(dir), "test", "--aot");
  expect(errors(together.said)).toEqual([]);
  expect(passed(together.said)).toEqual(["root", "two"]);
}, 60_000);

test("the paths of a tsconfig.json that is not above a file have a say about it only where that is the program's", async () => {
  using dir = tempDir("paths-of-the-tsconfigs-above", {
    "app/tsconfig.json": config({ "only-the-app": ["./known.ts"] }),
    "app/known.ts": `export type Known = number;\n`,
    "app/app.test.ts": `import { expect, test } from "bun:test";\nimport { one } from "../lib/index";\ntest("app", () => {\n  expect(one).toBe(1);\n});\n`,
    "lib/tsconfig.json": config(),
    "lib/index.ts": `import type { Known } from "only-the-app";\nexport const one: Known = 1;\n`,
    "lib/lib.test.ts": `import { expect, test } from "bun:test";\nimport { one } from "./index";\ntest("lib", () => {\n  expect(one).toBe(1);\n});\n`,
  });
  const ofTheLibrary = await run(String(dir), "test", "--aot", "./lib/lib.test.ts");
  expect({ errors: errors(ofTheLibrary.said), passed: passed(ofTheLibrary.said) }).toEqual({
    errors: ["lib/index.ts:1 TS2307"],
    passed: [],
  });
  const ofTheApplication = await run(String(dir), "test", "--aot", "./app/app.test.ts");
  expect({ errors: errors(ofTheApplication.said), passed: passed(ofTheApplication.said) }).toEqual({
    errors: [],
    passed: ["app"],
  });
  const both = await run(String(dir), "test", "--aot");
  expect({ errors: errors(both.said), passed: passed(both.said) }).toEqual({ errors: [], passed: ["app", "lib"] });
}, 60_000);
