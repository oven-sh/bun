import { expect } from "bun:test";
import { bunExe, tempDirWithBunTypes } from "harness";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ESNext",
    module: "Preserve",
    moduleResolution: "bundler",
    noEmit: true,
    types: ["bun"],
    strict: true,
  },
});

async function run(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const errors = (said: string) =>
  [
    ...Array.from(
      said.matchAll(/^(\S+)\((\d+),\d+\): error (TS\d+)/gm),
      match => `${match[1]}:${match[2]} ${match[3]}`,
    ),
    ...Array.from(
      said.matchAll(/^error: (TS\d+):.*\n\s+at \S*?(src|test)[\\/]([^\\/\s:]+):(\d+):\d+$/gm),
      match => `${match[2]}/${match[3]}:${match[4]} ${match[1]}`,
    ),
  ].sort();

const project = {
  "tsconfig.json": tsconfig,
  "src/global.ts": `declare global {\n  var SETTING: number | undefined;\n}\nexport {};\n`,
  "src/uses.ts": `export function setting(): number {\n  return globalThis.SETTING ?? 0;\n}\n`,
  "test/uses.test.ts": `import { expect, test } from "bun:test";\nimport { setting } from "../src/uses";\ntest("uses", () => {\n  expect(setting()).toBe(0);\n});\n`,
  "test/imports.test.ts": `import { expect, test } from "bun:test";\nimport "../src/global";\ntest("imports", () => {\n  expect(globalThis.SETTING).toBeUndefined();\n});\n`,
};

test("a tsconfig.json without `include` takes every file below it: what one of them declares globally is declared, with and without a neighbor that imports it", async () => {
  using dir = tempDirWithBunTypes("globals-without-include", project);
  const alone = await run(String(dir), "test", "--aot", "./test/uses.test.ts");
  expect(errors(alone.said)).toEqual([]);
  expect(passed(alone.said)).toEqual(["uses"]);
  const together = await run(String(dir), "test", "--aot");
  expect(errors(together.said)).toEqual([]);
  expect(passed(together.said)).toEqual(["imports", "uses"]);
  const checked = await run(String(dir), "check", "--aot", "src/uses.ts");
  expect(errors(checked.said)).toEqual([]);
}, 60_000);

test("a file that `exclude` takes out, and that no file of the project imports, declares nothing", async () => {
  const { "test/imports.test.ts": importsTheExcludedFile, ...others } = project;
  using dir = tempDirWithBunTypes("globals-without-include", {
    ...others,
    "tsconfig.json": JSON.stringify({ ...JSON.parse(tsconfig), exclude: ["src/global.ts"] }),
  });
  const { said, exitCode } = await run(String(dir), "test", "--aot", "./test/uses.test.ts");
  expect(errors(said)).toEqual(["src/uses.ts:2 TS7017"]);
  expect(exitCode).toBe(1);
}, 60_000);
