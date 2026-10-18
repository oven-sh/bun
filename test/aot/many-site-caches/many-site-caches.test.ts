import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "../supported";
import { functionCount, generateProgram, sitesInFunction } from "./generate-program";

async function run(cmd: string[], cwd: string) {
  await using ran = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

test.skipIf(isDebug || isASAN)(
  "a program with more sites than sixteen megabytes of caches hold is built and answers as plain Bun does",
  async () => {
    expect(functionCount * sitesInFunction).toBeGreaterThan(1_000_000);
    using dir = tempDir("aot-many-site-caches", { "main.js": generateProgram() });
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable], String(dir));
    expect({
      errors: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ errors: [], exitCode: 0 });
    const plain = await run([bunExe(), "run", "main.js"], String(dir));
    expect(plain.exitCode).toBe(0);
    const compiled = await run([executable], String(dir));
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  },
  900_000,
);
