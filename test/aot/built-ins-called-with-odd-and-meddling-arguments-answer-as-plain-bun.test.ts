// Every method of lists, typed arrays, DataView, Atomics, Buffer, ArrayBuffer and strings that the running Bun has, called with odd arguments and with arguments that change the receiver while they
// are converted. ./calls-of-the-built-ins-of-the-running-bun.ts writes the programs.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

async function run(cwd: string, ...cmd: string[]) {
  await using child = Bun.spawn({ cmd, cwd, env: bunEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

const written = await run(import.meta.dir, bunExe(), "calls-of-the-built-ins-of-the-running-bun.ts");
const programs: { name: string; calls: number; program: string }[] = JSON.parse(written.stdout);

test("there are calls of every class", () => {
  expect([...new Set(programs.map(({ name }) => name.replace(/, part \d+$/, "")))]).toEqual([
    "Array",
    "typed arrays",
    "DataView",
    "Atomics",
    "Buffer",
    "ArrayBuffer",
    "String",
  ]);
});

for (const { name, calls, program } of programs) {
  test.concurrent(
    name,
    async () => {
      using dir = tempDir("odd-and-meddling-arguments", {
        "main.mjs": program,
        "package.json": `{ "name": "odd-and-meddling-arguments" }`,
      });
      const plain = await run(String(dir), bunExe(), "main.mjs");
      expect(plain.stderr).toBe("");
      expect(plain.exitCode).toBe(0);
      expect(plain.stdout.trimEnd().split("\n")).toHaveLength(calls);
      const build = await run(String(dir), bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", "app");
      expect(build.stderr + build.stdout).not.toContain("error:");
      expect(build.exitCode).toBe(0);
      const compiled = await run(String(dir), join(String(dir), "app"));
      expect(compiled.stdout.split("\n")).toEqual(plain.stdout.split("\n"));
      expect(compiled.exitCode).toBe(0);
    },
    170_000,
  );
}
