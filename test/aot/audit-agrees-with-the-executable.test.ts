// `bun run --aot` and `bun test --aot` run a program on the ordinary engine with the rules of --aot applied, so that people learn what the compiled
// program will do before they build it. Each program here is run that way and as an executable, and the two must print the same.
import { expect } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { describe, test } from "./supported";

const folder = join(import.meta.dir, "audit-and-executable");
const disagreeToday: Record<string, string> = {
  "cast-whose-result-is-not-used.ts":
    "bun run --aot drops the check of a cast that is the operand of typeof, that is an expression statement, or whose constant is inlined; the executable throws",
  "object-entering-a-record-typed-parameter.ts":
    "where a function is entered, bun run --aot holds an object only to built-in classes and arrays; the executable holds it to a record type too, and throws",
};

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  return { stdout, exitCode };
}

for (const file of readdirSync(folder)
  .filter(name => name.endsWith(".ts"))
  .sort()) {
  describe(file, () => {
    let said: { executable: string; audit: string } | undefined;

    test("builds, and runs to its end both ways", async () => {
      using dir = tempDir("aot-audit-and-executable", {});
      const executable = join(String(dir), "program");
      expect(
        await run([bunExe(), "build", "--compile", "--aot", join(folder, file), "--outfile", executable], String(dir)),
      ).toMatchObject({ exitCode: 0 });
      const compiled = await run([executable], String(dir));
      const audited = await run([bunExe(), "run", "--aot", join(folder, file)], String(dir));
      expect({ executable: compiled.exitCode, audit: audited.exitCode }).toEqual({ executable: 0, audit: 0 });
      expect(compiled.stdout.split("\n").length).toBeGreaterThan(3);
      expect(audited.stdout.split("\n").length).toBe(compiled.stdout.split("\n").length);
      said = { executable: compiled.stdout, audit: audited.stdout };
    }, 120_000);

    (file in disagreeToday ? test.failing : test)("bun run --aot prints what the executable prints", () => {
      if (said === undefined) return;
      expect(said.audit).toBe(said.executable);
    });
  });
}
