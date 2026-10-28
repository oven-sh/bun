// Between two passes an operation that may throw or run code of the program goes only with a reason: its effects under the proven types of its operands say that it does neither, or the pass answers for it.
// `--aot-sabotage=ErasedValuesHaveEffects` has a pass take out what has lost its last use whatever it does. A build that verifies each pass names the pass, the function and the operation; without the sabotage it builds.
import { afterAll, expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { compileCommand } from "./harness/flags";
import { built, spawned } from "./run-programs";
import { describe, test } from "./supported";

describe("compile/aot/a build that verifies each pass stops where an operation that may throw goes", () => {
  const root = String(tempDir("aot-operations-that-go", {}));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const program = join(
    import.meta.dir,
    "programs/conditions-of-passes/lists-of-constants-answer-what-they-hold-now.ts",
  );
  const build = (...flags: string[]) =>
    spawned(
      [
        bunExe(),
        ...compileCommand,
        "--aot-verify-each-pass",
        ...flags,
        program,
        "--outfile",
        join(root, isWindows ? "program.exe" : "program"),
      ],
      root,
      bunEnv,
    );

  test("with the sabotage", async () => {
    const result = await build("--aot-sabotage=ErasedValuesHaveEffects");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(
      /verification failed after \w+; function '\w+' \(f\d+\); v\d+ \(\w+\) in b\d+ may throw or run code, and is gone/,
    );
  }, 600_000);

  test("without it", async () => {
    built(await build());
  }, 600_000);
});
