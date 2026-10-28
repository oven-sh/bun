// The top level of language/operators-outside-loops is one function of many thousand basic blocks. `--aot-check=validate-back-end` validates B3 and Air after every phase, and the time
// that takes must grow with the number of blocks, not with its square: the build ends well within the time limit of a test.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { writeProgram } from "./generate";
import { programs } from "./generate/language";
import { run } from "./harness/run";
import { test } from "./supported";

test.skipIf(isASAN || isDebug)(
  "a function of many thousand blocks builds with the back end validated",
  async () => {
    const program = programs().find(program => program.entry === "operators-outside-loops.ts")!;
    using dir = tempDir("aot-large-function-validated", {});
    const cwd = String(dir);
    writeProgram(cwd, program);
    const executable = join(cwd, isWindows ? "program.exe" : "program");
    const built = await run(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--aot-check=validate-back-end",
        program.entry,
        "--outfile",
        executable,
      ],
      cwd,
    );
    expect(built.stderr).not.toContain("error:");
    expect(built.exitCode).toBe(0);
    const [plain, compiled] = await Promise.all([run([bunExe(), program.entry], cwd), run([executable], cwd, bunEnv)]);
    expect(plain.exitCode).toBe(0);
    expect(compiled).toEqual(plain);
  },
  120_000,
);
