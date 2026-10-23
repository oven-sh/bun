import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { withoutCoreDump } from "../run-programs";
import { test } from "../supported";

// Each member of DeclaredTypesForTesting answers the value it was handed, whatever its schema declares. Nothing proves such a result, so compiled code expects the type and
// tests the value: with a value of another kind it does what plain Bun does. A build with assertions ends the process in native code instead: proven-returns.test.ts.
async function spawned(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.skipIf(isDebug || isASAN)(
  "a native result of another kind than its schema declares is taken as plain Bun takes it",
  async () => {
    using folder = tempDir("aot-declared-results-are-tested", {});
    const cwd = String(folder);
    cpSync(join(import.meta.dir, "declared-results-are-tested"), cwd, { recursive: true });
    const plain = await spawned([bunExe(), "--expose-internals", "run", "main.js"], cwd);
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout.split("\n").length).toBe(601);
    const built = await spawned([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "program"], cwd);
    expect(built.stderr).not.toContain("error:");
    expect(built.exitCode).toBe(0);
    const compiled = await spawned(withoutCoreDump([join(cwd, "program")]), cwd);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  },
  120_000,
);
