import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { withoutCoreDump } from "./run-programs";
import { test } from "./supported";

// look-alikes.ts holds an object of another class with the same members, one of them an accessor, where a class's instance is declared. Built together with beside.js, a read of a field
// behind the read of that member was planned for one of the two classes alone and read the other's object at the wrong place: the executable died.
// The environment of the tests turns the compiler's verifiers on, and they refuse such a build. A user's build has none, so this one is made without that variable: what is judged is the run.
const { BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: _, ...userEnv } = bunEnv;

async function spawned(cmd: string[], cwd: string) {
  const { stdout, stderr, exitCode } = await run(cmd, cwd, userEnv);
  return { stdout, stderr, exitCode };
}

test("a field of two classes is read at its place in each, behind a member that only one of them has as a field", async () => {
  using folder = tempDir("aot-one-test-made-twice", {});
  const cwd = String(folder);
  cpSync(join(import.meta.dir, "one-test-made-twice-on-values-of-two-types"), cwd, { recursive: true });
  const plain = await spawned([bunExe(), "run", "main.js", "0"], cwd);
  expect(plain.exitCode).toBe(0);
  const built = await spawned([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "program"], cwd);
  expect(built.stderr).not.toContain("error:");
  expect(built.exitCode).toBe(0);
  const compiled = await spawned(withoutCoreDump([join(cwd, "program"), "0"]), cwd);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}, 120_000);
