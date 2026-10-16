// What the compiler generates for the programs under ./programs, not only what they print. Many programs state it in comment
// lines (`// IR= 0 caller NewObjectWithShape`, `// CALLS- sum GetByVal`, `// SIZE< indexOfText 80`): a call is direct, nothing is
// allocated, a function stays small. These are the positive and negative tests of the optimizations: an optimization that stops
// working changes no output, so no other test notices. shell/expectations.py reads the lines and checks them; its head lists them.
//
// shell/tools.ts says what it needs: python3, the `jsc` shell and the front end.
//
// Where one is missing the test is skipped and says which. Each line of a failure is
// `FAIL <program> TAB <the line> TAB <what is not met>`.
//   JSC=.. SEMA=.. test/aot/shell/expectations.py strings/search     one program, in a second
import { expect, test } from "bun:test";
import { bunEnv, isASAN, isDebug } from "harness";
import { join } from "path";
import { jsc, python, sema, whyNoScriptRuns } from "./shell/tools";

const whySkipped = whyNoScriptRuns ?? (isASAN || isDebug ? "a sanitizer or debug build generates the same code many times slower" : undefined);
if (whySkipped) console.error(`SKIPPED: test/aot/generated-code.test.ts: ${whySkipped}`);

test.skipIf(!!whySkipped)(
  `the generated code is what the programs expect${whySkipped ? ` (SKIPPED: ${whySkipped})` : ""}`,
  async () => {
    await using checker = Bun.spawn({
      cmd: [python!, join(import.meta.dir, "shell", "expectations.py"), "all"],
      env: { ...bunEnv, JSC: jsc!, SEMA: sema! },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([checker.stdout.text(), checker.stderr.text(), checker.exited]);
    const lines = stdout.split("\n").filter(line => line !== "");
    expect(stderr).toBe("");
    expect(lines.at(-1)).toMatch(/^[1-9][0-9]* programs, [1-9][0-9]* expectation lines: /);
    expect(lines.slice(0, -1).filter(line => !line.startsWith("ok "))).toEqual([]);
    expect(exitCode).toBe(0);
  },
  170_000,
);
