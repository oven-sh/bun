// A few members of each kind that the running Bun has under its globals, on instances and in its built-in modules, bound in seven forms: read by their literal spelling in some forty ways, the
// questions asked in place. ./members.fixture.ts finds them and writes the programs. Each family has a test file of its own, and its programs are built one behind the other: a build keeps
// about two processors busy whatever their number, and nine at once shared the eight of the lane with sanitizers with two other test files.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { isThisFileLeftOut } from "../harness/left-out";
import { test } from "../supported";

export const families = [
  "globals",
  "instances",
  "named",
  "namespace",
  "default",
  "require",
  "destructured require",
  "import()",
  "getBuiltinModule",
] as const;

export async function run(cwd: string, ...cmd: string[]) {
  await using child = Bun.spawn({ cmd, cwd, env: bunEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

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

export async function testFamily(number: number) {
  if (isThisFileLeftOut()) return;
  const family = families[number - 1];
  const written = await run(import.meta.dir, bunExe(), "members.fixture.ts", family);
  const { members, programs }: { members: number; programs: string[] } = JSON.parse(written.stdout);

  test(`the walk finds the members: ${family}`, () => {
    expect(members).toBeGreaterThan(1000);
  });

  programs.forEach((program, part) =>
    test(
      `${family}, part ${part + 1} of ${programs.length}`,
      async () => expect(await expectTheAnswersOfPlainBun(program)).toBeGreaterThan(20),
      170_000,
    ),
  );
}
