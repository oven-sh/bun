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
  [...said.matchAll(/^error: (TS\d+): .*\n +at (\S+):(\d+):\d+$/gm)]
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
    "src/wrong.test.ts": `import { expect, test } from "bun:test";\nimport { wrong } from "./wrong";\ntest("never runs", () => {\n  expect(wrong).toBe("text");\n});\n`,
  });
  const together = await run(String(dir), "test", "--aot", "./src/wrong.test.ts", "./packages/host/src/host.test.ts");
  expect(errors(together.said)).toContain("src/wrong.ts:1 TS2322");
  expect(passed(together.said)).toEqual(["host"]);
}, 60_000);
