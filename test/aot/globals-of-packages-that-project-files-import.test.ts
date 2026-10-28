import { expect } from "bun:test";
import { bunExe, tempDirWithBunTypes } from "harness";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const options = {
  target: "ESNext",
  module: "Preserve",
  moduleResolution: "bundler",
  noEmit: true,
  types: ["bun"],
  strict: true,
};

async function run(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const errors = (said: string) =>
  [...said.matchAll(/^error: (TS\d+): .*\n +at \S*?(test\/\S+?):(\d+):\d+$/gm)]
    .map(match => `${match[2]}:${match[3]} ${match[1]}`)
    .sort();

const project = {
  "tsconfig.json": JSON.stringify({ compilerOptions: options, include: ["test"] }),
  "node_modules/@types/shapes/package.json": JSON.stringify({
    name: "@types/shapes",
    version: "1.0.0",
    types: "index.d.ts",
  }),
  "node_modules/@types/shapes/index.d.ts": `interface FromScript {\n  a: number;\n}\ndeclare module "shapes" {\n  export const made: FromScript;\n}\n`,
  "node_modules/@types/shapes/register.d.ts": `declare global {\n  interface FromSubpath {\n    b: string;\n  }\n}\nexport {};\n`,
  "node_modules/@types/shapes/folder/index.d.ts": `interface FromFolder {\n  c: boolean;\n}\n`,
  "node_modules/@types/shapes/module.d.ts": `interface NotGlobal {\n  d: number;\n}\nexport const one: NotGlobal;\n`,
  "node_modules/shapes/package.json": JSON.stringify({ name: "shapes", version: "1.0.0", main: "index.js" }),
  "node_modules/shapes/index.js": `exports.made = { a: 1 };\n`,
  "node_modules/shapes/register.js": ``,
  "node_modules/shapes/folder/index.js": ``,
  "node_modules/shapes/module.js": `exports.one = { d: 1 };\n`,
  "test/utils/setup.ts": `import "shapes";\nimport "shapes/register";\nimport "shapes/folder";\nimport "shapes/module";\n`,
  "test/uses.test.ts": `import { expect, test } from "bun:test";\nconst a: FromScript = { a: 1 };\nconst b: FromSubpath = { b: "x" };\nconst c: FromFolder = { c: true };\ntest("uses", () => {\n  expect(a.a + b.b.length + Number(c.c)).toBe(3);\n});\n`,
  "test/imports.test.ts": `import { expect, test } from "bun:test";\nimport { made } from "shapes";\nimport "shapes/register";\nimport "shapes/folder";\ntest("imports", () => {\n  expect(made.a).toBe(1);\n});\n`,
};

test("globals of a package that only another file of the project imports are declared, with and without a neighbor that imports it", async () => {
  using dir = tempDirWithBunTypes("globals-of-packages", project);
  const alone = await run(String(dir), "test", "--aot", "./test/uses.test.ts");
  expect(errors(alone.said)).toEqual([]);
  expect(passed(alone.said)).toEqual(["uses"]);
  const together = await run(String(dir), "test", "--aot");
  expect(errors(together.said)).toEqual([]);
  expect(passed(together.said)).toEqual(["imports", "uses"]);
  const checked = await run(String(dir), "check", "--aot", "test/uses.test.ts");
  expect({ errors: errors(checked.said), exitCode: checked.exitCode }).toEqual({ errors: [], exitCode: 0 });
}, 60_000);

test("what a module of such a package declares for itself is not global", async () => {
  using dir = tempDirWithBunTypes("globals-of-packages", {
    ...project,
    "test/uses.test.ts": `import { expect, test } from "bun:test";\nconst d: NotGlobal = { d: 1 };\ntest("never runs", () => {\n  expect(d.d).toBe(1);\n});\n`,
  });
  const { said, exitCode } = await run(String(dir), "test", "--aot", "./test/uses.test.ts");
  expect(errors(said)).toEqual(["test/uses.test.ts:2 TS2304"]);
  expect(exitCode).toBe(1);
});
