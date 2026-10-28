import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// The first 16 MB of the range of address space that holds the objects of an ahead-of-time compiled program are left unused. A range that is
// no larger has room for no object: the program says so and ends, it does not crash.

test.concurrent.each(["16", "1"])(
  "a compiled program whose range of address space for objects is %s MB says that it is too small",
  async size => {
    using folder = tempDir("aot-heap-limit-too-small", { "program.ts": `console.log("ran");\n` });
    const { stderr: buildErrors, exitCode: buildExitCode } = await run(
      [bunExe(), "build", "--compile", "--aot", "program.ts", "--outfile", "program"],
      String(folder),
    );
    expect({ stderr: buildErrors, exitCode: buildExitCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
    });
    await using program = Bun.spawn({
      cmd: [join(String(folder), "program")],
      cwd: String(folder),
      env: { ...bunEnv, BUN_JSC_markedBlockCageSizeInMB: size },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      program.stdout.text(),
      program.stderr.text(),
      program.exited,
    ]);
    expect(stderr).toContain(`don't fit in BUN_JSC_markedBlockCageSizeInMB=${size}`);
    expect({ stdout, exitCode, signalCode: program.signalCode }).toEqual({ stdout: "", exitCode: 1, signalCode: null });
  },
  120_000,
);
