import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const errors = (said: string) =>
  [...said.matchAll(/^(\S+)\((\d+),\d+\): error (TS\d+)/gm)].map(match => `${match[1]}:${match[2]} ${match[3]}`).sort();

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
  expect(errors(alone.said)).toEqual(["packages/one/one.test.ts:2 TS2307"]);
  const together = await run(String(dir), "test", "--aot");
  expect(errors(together.said)).toEqual(["packages/one/one.test.ts:2 TS2307"]);
  expect(passed(together.said)).toEqual(["root"]);
}, 60_000);

test("a type imported by a name that only a tsconfig.json further up knows is found, alone and beside a test file up there", async () => {
  using dir = tempDir("paths-of-the-tsconfigs-above", {
    ...atTheRoot,
    "tsconfig.json": config({ "core/*": ["./src/*"] }),
    "packages/two/tsconfig.json": config({ "helpers/*": ["./helpers/*"] }),
    "packages/two/two.test.ts": `import { expect, test } from "bun:test";\nimport type { Value } from "core/value";\nconst two: Value = 2;\ntest("two", () => {\n  expect(two).toBe(2);\n});\n`,
  });
  const alone = await run(String(dir), "test", "--aot", "./packages/two/two.test.ts");
  expect(errors(alone.said)).toEqual([]);
  expect(passed(alone.said)).toEqual(["two"]);
  const together = await run(String(dir), "test", "--aot");
  expect(errors(together.said)).toEqual([]);
  expect(passed(together.said)).toEqual(["root", "two"]);
}, 60_000);

test("the paths of a tsconfig.json that is not above a file have no say about it", async () => {
  using dir = tempDir("paths-of-the-tsconfigs-above", {
    "app/tsconfig.json": config({ "only-the-app": ["./known.ts"] }),
    "app/known.ts": `export type Known = number;\n`,
    "app/app.test.ts": `import { expect, test } from "bun:test";\nimport { one } from "../lib/index";\ntest("app", () => {\n  expect(one).toBe(1);\n});\n`,
    "lib/tsconfig.json": config(),
    "lib/index.ts": `import type { Known } from "only-the-app";\nexport const one: Known = 1;\n`,
    "lib/lib.test.ts": `import { expect, test } from "bun:test";\nimport { one } from "./index";\ntest("lib", () => {\n  expect(one).toBe(1);\n});\n`,
  });
  for (const files of [["./lib/lib.test.ts"], ["./app/app.test.ts"], []]) {
    const { said } = await run(String(dir), "test", "--aot", ...files);
    expect(errors(said)).toEqual(["lib/index.ts:1 TS2307"]);
    expect(passed(said)).toEqual([]);
  }
}, 60_000);
