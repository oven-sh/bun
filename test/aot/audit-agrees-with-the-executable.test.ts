// `bun run --aot` checks a program as `bun compile` does and then runs it from its source with the built-in objects read-only, so that people learn
// what the executable will do before they build it. `bun run --debug-aot` compiles it and runs that. Each program here is run both ways and as an
// executable, and all three must print the same.
import { expect } from "bun:test";
import { readdirSync } from "fs";
import { bunExe, tempDir } from "harness";
import { join } from "path";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

const folder = join(import.meta.dir, "audit-and-executable");

async function run(cmd: string[], cwd: string) {
  const { stdout, exitCode } = await runCommand(cmd, cwd);
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
      expect(await run([bunExe(), "run", "--debug-aot", join(folder, file)], String(dir))).toEqual(compiled);
      expect({ executable: compiled.exitCode, audit: audited.exitCode }).toEqual({ executable: 0, audit: 0 });
      expect(compiled.stdout.split("\n").length).toBeGreaterThan(3);
      expect(audited.stdout.split("\n").length).toBe(compiled.stdout.split("\n").length);
      said = { executable: compiled.stdout, audit: audited.stdout };
    }, 120_000);

    test("bun run --aot prints what the executable prints", () => {
      if (said === undefined) return;
      expect(said.audit).toBe(said.executable);
    });
  });
}
