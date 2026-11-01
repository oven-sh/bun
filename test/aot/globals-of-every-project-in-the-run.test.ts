import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { basename } from "node:path";
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
const config = JSON.stringify({ compilerOptions: options, include: ["src"] });

async function run(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return {
    said: (stdout + stderr).replaceAll("\\", "/").replace(new RegExp(`\\S*${basename(cwd)}/`, "g"), ""),
    exitCode,
  };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const errors = (said: string) =>
  [...said.matchAll(/^(?:error|warn): (TS\d+): .*\n +at (\S+):(\d+):\d+$/gm)]
    .map(match => `${match[2]}:${match[3]} ${match[1]}`)
    .sort();

const packages = {
  "packages/host/package.json": JSON.stringify({ name: "host" }),
  "packages/host/tsconfig.json": config,
  "packages/host/src/host.d.ts": `declare namespace Host {\n  interface Clock {\n    now(): number;\n  }\n}\n`,
  "packages/host/src/shared.ts": `declare global {\n  interface Shared {\n    level: number;\n  }\n}\nexport {};\n`,
  "packages/host/src/host.test.ts": `import { expect, test } from "bun:test";\nconst clock: Host.Clock = { now: () => 1 };\nconst shared: Shared = { level: 2 };\ntest("host", () => {\n  expect(clock.now() + shared.level).toBe(3);\n});\n`,
  "packages/other/package.json": JSON.stringify({ name: "other" }),
  "packages/other/tsconfig.json": config,
  "packages/other/src/other.test.ts": `import { expect, test } from "bun:test";\ntest("other", () => {\n  expect(1).toBe(1);\n});\n`,
};

test.each([
  ["nothing but references", { files: [], references: [{ path: "packages/host" }, { path: "packages/other" }] }],
  ["files of its own", { compilerOptions: options, include: ["scripts"] }],
])(
  "what a project declares globally is known to its test files beside those of another project, under a tsconfig.json with %s",
  async (_, root) => {
    using dir = tempDir("globals-of-every-project", {
      ...packages,
      "tsconfig.json": JSON.stringify(root),
      "scripts/build.ts": `export {};\n`,
    });
    const alone = await run(String(dir), "test", "--aot", "./packages/host/src/host.test.ts");
    expect({ errors: errors(alone.said), passed: passed(alone.said) }).toEqual({ errors: [], passed: ["host"] });
    const together = await run(String(dir), "test", "--aot");
    expect({ errors: errors(together.said), passed: passed(together.said) }).toEqual({
      errors: [],
      passed: ["host", "other"],
    });
  },
  60_000,
);

test("a file of another entry point's project outside the program's rootDir does not keep anything from being type checked", async () => {
  using dir = tempDir("globals-of-every-project", {
    ...packages,
    "tsconfig.json": JSON.stringify({
      compilerOptions: { ...options, noEmit: false, outDir: "./dist", rootDir: "./src" },
      include: ["src"],
    }),
    "src/wrong.ts": `export const wrong: number = "text";\n`,
    "src/wrong.test.ts": `import { expect, test } from "bun:test";\nimport { wrong } from "./wrong";\ntest("wrong", () => {\n  expect(wrong).toBe("text");\n});\n`,
  });
  const together = await run(String(dir), "test", "--aot", "./src/wrong.test.ts", "./packages/host/src/host.test.ts");
  expect(errors(together.said)).toContain("src/wrong.ts:1 TS2322");
  expect(passed(together.said)).toEqual(["host", "wrong"]);
}, 60_000);

test.each([
  ["allowJs", "main.test.js", `import { said } from "./user.js";`, { "two/user.js": `export const said = 1;\n` }],
  [
    "resolveJsonModule",
    "main.test.ts",
    `import data from "./data.json";\nconst said: number = data.said;`,
    { "two/data.json": `{ "said": 1 }\n` },
  ],
])(
  "the files that %s of one project lists do not stop a run whose first test file lies under a tsconfig.json without it",
  async (option, name, imports, files) => {
    using dir = tempDir("globals-of-every-project", {
      "one/tsconfig.json": JSON.stringify({ compilerOptions: { ...options, [option]: false } }),
      "one/main.test.ts": `import { expect, test } from "bun:test";\nconst n: number = 1;\ntest("one", () => {\n  expect(n).toBe(1);\n});\n`,
      "two/tsconfig.json": JSON.stringify({
        compilerOptions: { ...options, [option]: true },
        include: ["**/*", "*.json"],
      }),
      [`two/${name}`]: `import { expect, test } from "bun:test";\n${imports}\ntest("two", () => {\n  expect(said).toBe(1);\n});\n`,
      ...files,
    });
    for (const args of [
      [],
      ["--isolate"],
      ["./one/main.test.ts", `./two/${name}`],
      [`./two/${name}`, "./one/main.test.ts"],
    ]) {
      const together = await run(String(dir), "test", "--aot", ...args);
      const said = together.said.match(/^(?:error|warn): TS\d+/gm) ?? [];
      expect({ args, said, passed: passed(together.said), exitCode: together.exitCode }).toEqual({
        args,
        said: [],
        passed: ["one", "two"],
        exitCode: 0,
      });
    }
  },
  120_000,
);

test.each([
  ["a loose test file among strict ones has no type error", true, []],
  ["a strict test file among loose ones has its type error", false, ["other/other.test.ts:3 TS2322"]],
])(
  "a test file is judged by the strictness of the tsconfig.json nearest to it: %s",
  async (_, strict, expected) => {
    const most = (n: number) =>
      `import { expect, test } from "bun:test";\nfunction add(x: number): number {\n  return x + ${n};\n}\ntest("most ${n}", () => {\n  expect(add(1)).toBe(${n + 1});\n});\n`;
    using dir = tempDir("globals-of-every-project", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { ...options, strict } }),
      "most/one.test.ts": most(1),
      "most/two.test.ts": most(2),
      "other/tsconfig.json": JSON.stringify({ compilerOptions: { ...options, strict: !strict } }),
      "other/helper.ts": `export function twice(x: number): number {\n  return x === null ? -1 : x * 2;\n}\n`,
      "other/other.test.ts": `import { expect, test } from "bun:test";\nimport { twice } from "./helper";\nfunction own(flag: boolean): number { if (flag) return 2; return null; }\ntest("other", () => {\n  expect([own(true), own(false), twice(own(true)), twice(own(false))]).toEqual([2, null, 4, -1]);\n});\n`,
    });
    for (const args of [[], ["--isolate"]]) {
      const together = await run(String(dir), "test", "--aot", ...args);
      expect({
        args,
        errors: errors(together.said),
        passed: passed(together.said),
        exitCode: together.exitCode,
      }).toEqual({
        args,
        errors: expected,
        passed: ["most 1", "most 2", "other"],
        exitCode: 0,
      });
    }
  },
  120_000,
);
