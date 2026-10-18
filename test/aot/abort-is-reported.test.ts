import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";

if (isASAN)
  console.error(
    "SKIPPED: abort-is-reported.test.ts: in a Bun built with AddressSanitizer its handler answers, not Bun's",
  );

// A failed assertion of the engine ends the process. It has to say so: on Windows abort() reaches no exception handler and the
// process used to end with 0xC0000409 and not a word. The option makes the engine end that way at the first module that is loaded.
test.skipIf(isASAN)(
  "a process that the engine ends says that it crashed",
  async () => {
    using dir = tempDir("abort-is-reported", { "main.ts": `console.log("never printed");` });
    const withoutCoreDump = isWindows ? [] : ["sh", "-c", 'ulimit -c 0; exec "$0" "$@"'];
    await using proc = Bun.spawn({
      cmd: [...withoutCoreDump, bunExe(), "run", "main.ts"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        BUN_JSC_crashIfInterpreterIsUsed: "1",
        BUN_CRASH_REPORT_URL: "",
        BUN_ENABLE_CRASH_REPORTING: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("crashIfInterpreterIsUsed: ");
    expect(stderr).toContain("Bun has crashed");
    expect(exitCode).not.toBe(0);
  },
  60_000,
);
