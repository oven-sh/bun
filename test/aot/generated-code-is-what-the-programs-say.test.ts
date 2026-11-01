// A program under parallel/ may say what the compiler makes of it: `// IR=`, `// CALLS-`, `// KNOWN`, `// COUNTER:`, `//!` and the like.
// run-parallel.ts builds with Bun and sees neither the IR nor the machine code, so it passes over all of them but `// COUNTER:`.
// shell/expectations.py asks them, of testaot and the `jsc` shell. shell/known-failures.txt lists the lines that are not met today:
// one more fails here, and so does a listed one that is met again, so the list only gets shorter.
import { expect } from "bun:test";
import { isArm64, isASAN, isDebug, isLinux } from "harness";
import { join } from "path";
import { test } from "./harness/declare";
import { run } from "./harness/run";
import { python, scriptEnvironment, scriptSkipReason } from "./shell/tools";

const skipReason =
  scriptSkipReason ??
  (isASAN || isDebug ? "a sanitizer or debug build generates the same code many times slower" : undefined) ??
  (isArm64 || !isLinux ? "the list of what is not met today is kept on x86-64 Linux" : undefined);
if (skipReason) console.error(`SKIPPED: test/aot/generated-code-is-what-the-programs-say.test.ts: ${skipReason}`);

test.skipIf(!!skipReason)(
  "every line that only expectations.py reads is met or listed",
  async () => {
    const { stdout, stderr, exitCode } = await run(
      [python!, join(import.meta.dir, "shell", "expectations.py"), "all"],
      undefined,
      scriptEnvironment(),
    );
    const lines = stdout.split("\n").filter(line => line !== "");
    expect(stderr).toBe("");
    expect(lines.slice(0, -1).filter(line => !line.startsWith("ok "))).toEqual([]);
    expect(lines.at(-1)).toMatch(/^[1-9]\d* programs, [1-9]\d* expectation lines: 0 programs fail; /);
    expect(exitCode).toBe(0);
  },
  290_000,
);
