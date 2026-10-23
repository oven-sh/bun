import { expect } from "bun:test";
import { bunEnv, bunExe, isMacOS, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

test.skipIf(!isMacOS)(
  "an executable runs its compiled code with a library inserted by dyld",
  async () => {
    using dir = tempDir("aot-inserted-library", { "main.ts": `console.log("hello");\n` });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", "program"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({
      stderr: expect.any(String),
      exitCode: 0,
    });
    const { stdout, stderr, exitCode } = await run([join(String(dir), "program")], String(dir), {
      ...bunEnv,
      DYLD_INSERT_LIBRARIES: "/usr/lib/libz.1.dylib",
      BUN_JSC_crashIfInterpreterIsUsed: "1",
    });
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "hello\n", stderr: "", exitCode: 0 });
  },
  120_000,
);
