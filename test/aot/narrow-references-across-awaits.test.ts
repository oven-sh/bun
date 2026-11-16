// The word of an optional field is a 32-bit reference. The frame that an await saves holds the references that it lists as roots, and the compiler's own check of machine code says where another one is read behind it.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const program = await Bun.file(
  join(import.meta.dir, "parallel/narrow-references/optional-fields-across-awaits.ts"),
).text();

test("references that are read behind an await are roots of it", async () => {
  using dir = tempDir("aot-narrow-references-across-awaits", { "main.ts": program });
  const cwd = String(dir);
  const { stderr, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", join(cwd, isWindows ? "app.exe" : "app")],
    cwd,
    { ...bunEnv, BUN_JSC_verifyAOTMachineCode: "1" },
  );
  expect(stderr).not.toContain("NarrowReferenceWithoutPointer");
  expect(stderr).not.toMatch(/^error\b/m);
  expect(exitCode).toBe(0);
});
