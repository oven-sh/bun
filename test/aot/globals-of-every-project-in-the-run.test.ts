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
const config = JSON.stringify({ compilerOptions: options, include: ["src"] });

async function run(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const errors = (said: string) =>
  [...said.matchAll(/^(\S+)\((\d+),\d+\): error (TS\d+)/gm)].map(match => `${match[1]}:${match[2]} ${match[3]}`).sort();

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

test.todo.each([
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
