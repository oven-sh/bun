// What the compiler generates for the programs under ./programs, not only what they print. Many programs state it in comment
// lines (`// IR= 0 caller NewObject`, `// CALLS- sum GetByVal`, `// SIZE< indexOfText 80`): a call is direct, nothing is
// allocated, a function stays small. These are the positive and negative tests of the optimizations: an optimization that stops
// working changes no output, so no other test notices. shell/expectations.py reads the lines and checks them; its head lists them.
//
// shell/tools.ts says what it needs: python3, `jsc`, `testaot` and the front end.
//
// Where one is missing the test is skipped and says which. Each line of a failure is
// `FAIL <program> TAB <the line> TAB <what is not met>`.
//   JSC=.. TESTAOT=.. FRONT_END=.. test/aot/shell/expectations.py strings/search     one program, in a second
import { expect, test } from "bun:test";
import { isArm64, isASAN, isDebug } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { python, scriptEnvironment, scriptSkipReason } from "./shell/tools";

const skipReason =
  scriptSkipReason ??
  (isASAN || isDebug ? "a sanitizer or debug build generates the same code many times slower" : undefined) ??
  // TODO: state the sizes, the counts of instructions and the mnemonics for ARM64 too. The lines about the IR and about calls hold on both, and x86-64 checks them.
  (isArm64 ? "the programs state sizes and instructions of x86-64's code" : undefined);
if (skipReason) console.error(`SKIPPED: test/aot/generated-code.test.ts: ${skipReason}`);

(skipReason ? test.skip : test)(
  `the generated code is what the programs expect${skipReason ? ` (SKIPPED: ${skipReason})` : ""}`,
  async () => {
    const { stdout, stderr, exitCode } = await run(
      [python!, join(import.meta.dir, "shell", "expectations.py"), "all"],
      undefined,
      scriptEnvironment(),
    );
    const lines = stdout.split("\n").filter(line => line !== "");
    expect(stderr).toBe("");
    expect(lines.at(-1)).toMatch(/^[1-9][0-9]* programs, [1-9][0-9]* expectation lines: /);
    expect(lines.slice(0, -1).filter(line => !line.startsWith("ok "))).toEqual([]);
    expect(exitCode).toBe(0);
  },
  280_000,
);
