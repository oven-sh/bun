import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { run } from "./harness/run";

if (isASAN)
  console.error(
    "SKIPPED: abort-is-reported.test.ts: in a Bun built with AddressSanitizer its handler answers, not Bun's",
  );

// A failed assertion of the engine ends the process. It has to say so. The option makes the engine end that way at the first module that is loaded.
// TODO: on Windows abort() reaches no exception handler, and only a process that has loaded a compiled program catches it: `bun run`
// ends with 0xC0000409 and not a word. This needs a compiled program that makes the engine abort.
test.skipIf(isASAN).todoIf(isWindows)(
  "a process that the engine ends says that it crashed",
  async () => {
    using dir = tempDir("abort-is-reported", { "main.ts": `console.log("never printed");` });
    const withoutCoreDump = isWindows ? [] : ["sh", "-c", 'ulimit -c 0; exec "$0" "$@"'];
    const { stdout, stderr, exitCode } = await run([...withoutCoreDump, bunExe(), "run", "main.ts"], String(dir), {
      ...bunEnv,
      BUN_JSC_crashIfInterpreterIsUsed: "1",
      BUN_CRASH_REPORT_URL: "",
      BUN_ENABLE_CRASH_REPORTING: "0",
    });
    expect(stdout).toBe("");
    expect(stderr).toContain("crashIfInterpreterIsUsed: ");
    expect(stderr).toContain("Bun has crashed");
    expect(exitCode).not.toBe(0);
  },
  60_000,
);
