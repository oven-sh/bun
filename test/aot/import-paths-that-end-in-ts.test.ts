import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { relative } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const options = {
  target: "ESNext",
  module: "ESNext",
  moduleResolution: "bundler",
  types: [] as string[],
  strict: true,
  outDir: "dist",
};

async function run(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const errors = (said: string) =>
  [...said.matchAll(/^(\S+)\((\d+),\d+\): error (TS\d+)/gm)].map(match => `${match[1]}:${match[2]} ${match[3]}`).sort();
const buildErrors = (said: string, root: string) =>
  [...said.matchAll(/^error: (TS\d+):[^]*?^ +at (.+):(\d+):\d+$/gm)]
    .map(match => `${relative(root, match[2]).replaceAll("\\", "/")}:${match[3]} ${match[1]}`)
    .sort();

const files = {
  "tsconfig.json": JSON.stringify({ compilerOptions: options, include: ["src"] }),
  "src/value.ts": `export const value: number = 1;\n`,
  "main.ts": `import { value } from "./src/value.ts";\nconsole.log(value);\n`,
  "test/tsconfig.json": JSON.stringify({ compilerOptions: { ...options, rootDir: ".." } }),
  "test/value.test.ts": `import { expect, test } from "bun:test";\nimport { value } from "../src/value.ts";\ntest("value", () => {\n  expect(value).toBe(1);\n});\n`,
  "test/wrong.test.ts": `import { expect, test } from "bun:test";\nimport { value } from "../src/value.ts";\nconst text: string = value;\ntest("never runs", () => {\n  expect(typeof text).toBe("number");\n});\n`,
};

test("an import path that ends in .ts needs no allowImportingTsExtensions under --aot: Bun finds the file", async () => {
  using dir = tempDir("import-paths-that-end-in-ts", files);
  const tested = await run(String(dir), "test", "--aot");
  expect(buildErrors(tested.said, String(dir))).toEqual(["test/wrong.test.ts:3 TS2322"]);
  const testedOne = await run(String(dir), "test", "--aot", "./test/value.test.ts");
  expect(buildErrors(testedOne.said, String(dir))).toEqual([]);
  expect(passed(testedOne.said)).toEqual(["value"]);
  const checked = await run(String(dir), "check", "--aot", "main.ts");
  expect(errors(checked.said)).toEqual([]);
  expect(checked.exitCode).toBe(0);
}, 120_000);

test.todo(
  "a tsconfig.json with an outDir and no rootDir does not stop bun test --aot with TS6059 where a test imports a file outside its folder: nothing is emitted",
);

test("bun check without --aot reports it as tsc does", async () => {
  using dir = tempDir("import-paths-that-end-in-ts", files);
  const { said, exitCode } = await run(String(dir), "check", "main.ts");
  expect(errors(said)).toEqual(["main.ts:1 TS5097"]);
  expect(exitCode).toBe(1);
});
