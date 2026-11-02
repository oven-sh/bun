// A `// IRM=` line in a program counts operations in the top-level code of the program's own module.
// shell/expectations.py has to find that code in the printed IR first. If it cannot, every such line fails.
import { expect, test } from "bun:test";
import { isArm64, isASAN, isDebug } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { python, scriptEnvironment, scriptSkipReason } from "./shell/tools";

const skipReason =
  scriptSkipReason ??
  (isASAN || isDebug ? "a sanitizer or debug build generates the same code many times slower" : undefined) ??
  (isArm64 ? "the IR is the same on every platform, and x86-64 checks it" : undefined);
if (skipReason) console.error(`SKIPPED: test/aot/generated-code-of-module-bodies.test.ts: ${skipReason}`);

const programs = ["calls-fast-paths/array-methods-in-hot-caller", "calls-fast-paths/rest-read-in-typed-code"];

test.skipIf(!!skipReason)(
  "expectations.py finds the top-level code of a module",
  async () => {
    const { stdout, stderr } = await run(
      [python!, join(import.meta.dir, "shell", "expectations.py"), ...programs],
      undefined,
      scriptEnvironment(),
    );
    const lines = stdout.split("\n").filter(line => line !== "");
    expect(stderr).toBe("");
    expect(lines.at(-1)).toStartWith(`${programs.length} programs, `);
    expect(lines.filter(line => line.includes("// IRM="))).toEqual([]);
  },
  120_000,
);
