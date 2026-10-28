// With every limit of the compiler at 1 this program is refused, and one of its regular expressions gets no code. The note about the pattern comes when the errors have been handed
// over already. Such a build prints what it has to say and exits: no signal ends it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { spawned, withoutCoreDump } from "./run-programs";
import { test } from "./supported";

test("the build exits by itself", async () => {
  using folder = tempDir("aot-error-beside-a-pattern-without-code", {});
  const program = join(import.meta.dir, "programs", "strings", "regexps-from-constant-templates.ts");
  const build = await spawned(
    withoutCoreDump([
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--aot-limit=All:1",
      program,
      "--outfile",
      join(String(folder), "program"),
    ]),
    String(folder),
    { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
  );
  expect({ signal: build.signal, exitsByItself: build.exitCode === 0 || build.exitCode === 1 }).toEqual({
    signal: null,
    exitsByItself: true,
  });
});
