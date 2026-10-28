// A package names the TypeScript that `--aot` compiles under the "aot" condition of its `exports`. Nothing else reads the condition.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { spawned } from "./run-programs";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };

const files = {
  "package.json": JSON.stringify({ name: "app", version: "1.0.0" }),
  "main.ts": `import { which } from "shapes";
import { which as nested } from "shapes/nested";
import { which as deep } from "shapes/deep/a";
import plain from "plain";
console.log([which, nested, deep, require("shapes").which, plain].join(" "));
`,
  "main.test.ts": `import { test } from "bun:test";
import { which } from "shapes";
test("prints", () => console.log("loaded: " + which));
`,
  "node_modules/shapes/package.json": JSON.stringify({
    name: "shapes",
    version: "1.0.0",
    type: "module",
    exports: {
      ".": { types: "./index.d.ts", aot: "./index.aot.ts", default: "./index.js" },
      "./nested": { import: { aot: "./nested.aot.ts", default: "./nested.js" }, default: "./nested.js" },
      "./deep/*": { aot: "./deep/*.aot.ts", default: "./deep/*.js" },
    },
  }),
  "node_modules/shapes/index.d.ts": `export declare const which: string;\n`,
  "node_modules/plain/package.json": JSON.stringify({ name: "plain", version: "1.0.0", main: "index.js" }),
  "node_modules/plain/index.js": `module.exports = "plain";\n`,
  ...Object.fromEntries(
    ["index", "nested", "deep/a"].flatMap(name => [
      [`node_modules/shapes/${name}.js`, `export const which = "js";\n`],
      [`node_modules/shapes/${name}.aot.ts`, `export const which: string = "aot";\n`],
    ]),
  ),
};

const honored = "aot aot aot aot plain";
const ignored = "js js js js plain";
const executable = isWindows ? "out.exe" : "out";

async function run(root: string, ...command: string[]) {
  const { stdout, stderr, exitCode } = await spawned(command, root, env);
  return { printed: stdout.trim(), stderr, exitCode };
}

describe.concurrent("the aot condition", () => {
  test("bun build --compile --aot compiles the file that it names", async () => {
    using dir = tempDir("aot-condition", files);
    const root = String(dir);
    const built = await run(root, bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", executable);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/^(error|warn)/m),
      exitCode: 0,
    });
    expect(await run(root, join(root, executable))).toMatchObject({ printed: honored, exitCode: 0 });
  });

  test.each([
    ["bun run --aot", ["run", "--aot", "./main.ts"]],
    ["bun --aot", ["--aot", "./main.ts"]],
    ["bun run --aot-log-type-mismatches", ["run", "--aot-log-type-mismatches", "./main.ts"]],
  ])("%s runs the file that it names", async (_, command) => {
    using dir = tempDir("aot-condition", files);
    expect(await run(String(dir), bunExe(), ...command)).toMatchObject({ printed: honored, exitCode: 0 });
  });

  test("bun test --aot runs the file that it names, and bun test does not", async () => {
    using dir = tempDir("aot-condition", files);
    const withFlag = await run(String(dir), bunExe(), "test", "--aot", "./main.test.ts");
    expect(withFlag.printed + withFlag.stderr).toContain("loaded: aot");
    const without = await run(String(dir), bunExe(), "test", "./main.test.ts");
    expect(without.printed + without.stderr).toContain("loaded: js");
  });

  test("bun check --aot reads the file that it names", async () => {
    using dir = tempDir("aot-condition", {
      ...files,
      "node_modules/shapes/index.aot.ts": `export const which: number = 1;\n`,
      "main.ts": `import { which } from "shapes";\nexport const text: string = which;\n`,
    });
    const checked = await run(String(dir), bunExe(), "check", "--aot", "--no-pretty", "./main.ts");
    expect(checked.printed + checked.stderr).toContain("TS2322");
    expect(checked.exitCode).not.toBe(0);
    const plain = await run(String(dir), bunExe(), "check", "--no-pretty", "./main.ts");
    expect(plain.printed + plain.stderr).not.toContain("TS2322");
  });

  test("bun run ignores it", async () => {
    using dir = tempDir("aot-condition", files);
    expect(await run(String(dir), bunExe(), "run", "./main.ts")).toMatchObject({ printed: ignored, exitCode: 0 });
  });

  test("bun build --compile without --aot ignores it", async () => {
    using dir = tempDir("aot-condition", files);
    const root = String(dir);
    const built = await run(root, bunExe(), "build", "--compile", "./main.ts", "--outfile", executable);
    expect(built.exitCode).toBe(0);
    expect(await run(root, join(root, executable))).toMatchObject({ printed: ignored, exitCode: 0 });
  });

  test("bun build ignores it", async () => {
    using dir = tempDir("aot-condition", files);
    const root = String(dir);
    const built = await run(root, bunExe(), "build", "--target=bun", "./main.ts", "--outfile", "bundle.js");
    expect(built.exitCode).toBe(0);
    expect(await run(root, bunExe(), "bundle.js")).toMatchObject({ printed: ignored, exitCode: 0 });
  });

  test("require.resolve and import.meta.resolve ignore it", async () => {
    using dir = tempDir("aot-condition", {
      ...files,
      "resolve.ts": `console.log(require.resolve("shapes").endsWith("index.js"), import.meta.resolve("shapes/nested").endsWith("nested.js"));\n`,
    });
    expect(await run(String(dir), bunExe(), "run", "./resolve.ts")).toMatchObject({
      printed: "true true",
      exitCode: 0,
    });
  });

  test("--conditions=aot asks for it by name, like any condition", async () => {
    using dir = tempDir("aot-condition", files);
    const ran = await run(String(dir), bunExe(), "--conditions=aot", "run", "./main.ts");
    expect(ran).toMatchObject({ printed: honored, exitCode: 0 });
  });
});
