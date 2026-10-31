// A few members of each kind that the running Bun has under its globals, on instances and in its built-in modules, bound in seven forms: read by their literal spelling in some forty ways, the
// questions asked in place. ./members-of-the-running-bun.ts finds them and writes the programs.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

async function run(cwd: string, ...cmd: string[]) {
  await using child = Bun.spawn({ cmd, cwd, env: bunEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

const written = await run(import.meta.dir, bunExe(), "members-of-the-running-bun.ts");
const families: { family: string; members: number; program: string }[] = JSON.parse(written.stdout);

test("the walk finds the members of every family", () => {
  expect(families.map(({ family }) => family)).toEqual([
    "globals",
    "instances",
    "named",
    "namespace",
    "default",
    "require",
    "destructured require",
    "import()",
    "getBuiltinModule",
  ]);
  for (const { members } of families) expect(members).toBeGreaterThan(1000);
});

async function expectTheAnswersOfPlainBun(program: string) {
  using dir = tempDir("members-of-each-kind", {
    "main.mjs": program,
    "package.json": `{ "name": "members-of-each-kind" }`,
  });
  const plain = await run(String(dir), bunExe(), "main.mjs");
  expect(plain.stderr).toBe("");
  expect(plain.exitCode).toBe(0);
  const build = await run(String(dir), bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", "app");
  expect(build.stderr + build.stdout).not.toContain("error:");
  expect(build.exitCode).toBe(0);
  const compiled = await run(String(dir), join(String(dir), "app"));
  expect(compiled.stdout.split("\n")).toEqual(plain.stdout.split("\n"));
  expect(compiled.exitCode).toBe(0);
  return plain.stdout.split("\n").length;
}

for (const { family, program } of families)
  test.concurrent(family, async () => expect(await expectTheAnswersOfPlainBun(program)).toBeGreaterThan(20), 170_000);
