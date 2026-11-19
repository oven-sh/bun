import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const manifest = (name: string) =>
  JSON.stringify({
    name,
    version: "1.0.0",
    exports: { ".": { aot: "./index.aot.ts", types: "./index.d.ts", default: "./index.js" } },
  });

function packageFiles(name: string, source: string) {
  return {
    [`node_modules/${name}/package.json`]: manifest(name),
    [`node_modules/${name}/index.aot.ts`]: source,
    [`node_modules/${name}/index.d.ts`]: "export declare function greet(name: string): string;\n",
    [`node_modules/${name}/index.js`]: 'export function greet(name) {\n  return "hello " + name;\n}\n',
  };
}

const sound = 'export function greet(name: string): string {\n  return "hello " + name;\n}\n';
const oneError = `const n: number = "bad";\n${sound}export const kept = n;\n`;
const twoErrors = `const n: number = "bad";\nconst m: string = 1;\n${sound}export const kept = [n, m];\n`;
const app = { "package.json": '{ "name": "app" }\n' };

async function check(files: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("aot-check-dependency-type-errors", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", ...flags, "./main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = (stdout + stderr).split("\n").map(line => line.replaceAll("\\", "/"));
  return {
    found: lines.filter(line => /TS\d+:/.test(line)),
    closing: lines
      .find(line => /No type errors|^Found /.test(line))
      ?.replace(/^(✓ No type errors in \d+ files?),.*$/, "$1"),
    exitCode,
  };
}

test.concurrent(
  "without --all, one warning names each package and the files with errors are not counted as clean",
  async () => {
    const files = {
      ...app,
      ...packageFiles("greeter", oneError),
      ...packageFiles("@scope/other", twoErrors),
      ...packageFiles("sound", sound),
      "main.ts":
        'import { greet } from "greeter";\nimport { greet as other } from "@scope/other";\nimport { greet as third } from "sound";\nconsole.log(greet("a"), other("b"), third("c"));\n',
    };
    expect(await check(files)).toEqual({
      found: [
        `warning TS100308: The package "@scope/other" has 2 type errors in the TypeScript that is compiled. Your build doesn't stop for them. To list them, run bun check --aot --all`,
        `warning TS100308: The package "greeter" has 1 type error in the TypeScript that is compiled. Your build doesn't stop for them. To list them, run bun check --aot --all`,
      ],
      closing: "✓ No type errors in 2 files",
      exitCode: 0,
    });
  },
);

test.concurrent("with --all, each error of a package is listed like one of the program's own", async () => {
  const files = {
    ...app,
    ...packageFiles("greeter", twoErrors),
    "main.ts": 'import { greet } from "greeter";\nconsole.log(greet("a"));\n',
  };
  expect(await check(files, "--all")).toEqual({
    found: [
      "node_modules/greeter/index.aot.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      "node_modules/greeter/index.aot.ts(2,7): error TS2322: Type 'number' is not assignable to type 'string'.",
    ],
    closing: "Found 2 errors in 1 file, checked 2 files",
    exitCode: 1,
  });
});

test.concurrent("a package without type errors changes nothing", async () => {
  const files = {
    ...app,
    ...packageFiles("sound", sound),
    "main.ts": 'import { greet } from "sound";\nconsole.log(greet("a"));\n',
  };
  const expected = { found: [], closing: "✓ No type errors in 2 files", exitCode: 0 };
  expect(await check(files)).toEqual(expected);
  expect(await check(files, "--all")).toEqual(expected);
});

test.concurrent("the build does not stop for a type error in a package", async () => {
  using dir = tempDir("aot-build-dependency-type-errors", {
    ...app,
    ...packageFiles("greeter", oneError),
    "main.ts": 'import { greet } from "greeter";\nconsole.log(greet("a"));\n',
  });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", "app"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [said, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect(said).not.toContain("TS100308");
  expect(said).not.toContain("TS2322");
  expect(buildExitCode).toBe(0);
});
