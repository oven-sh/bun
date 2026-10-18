// shell/dropped-protections.py as a test: each place in the compiler that keeps an object alive for a 32-bit reference is left
// out, one at a time, and something must notice: the check over compiled code, or a program that goes wrong.
//
// shell/tools.ts says what it needs. Linux x64 only, as the tests under collector-stress: with fewer registers, fewer stale copies
// of a pointer lie about that would keep a value alive by accident.
//   JSC=.. SEMA=.. python3 test/aot/shell/dropped-protections.py --table
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, isASAN, isDebug, isLinux } from "harness";
import { availableParallelism } from "os";
import { join } from "path";
import { unsupported } from "./run-programs";
import { jsc, python, sema, whyNoScriptRuns } from "./shell/tools";

const whySkipped = whyNoScriptRuns ?? (isLinux && process.arch === "x64" && !isASAN && !isDebug ? undefined : "it is run on release builds for Linux x64, which show the most");
if (whySkipped && !unsupported) console.error(`SKIPPED: test/aot/dropped-protections.test.ts: ${whySkipped}`);

test.skipIf(!!whySkipped)(
  "every protection of a 32-bit reference that is left out is noticed",
  async () => {
    await using script = Bun.spawn({
      cmd: [python!, join(import.meta.dir, "shell", "dropped-protections.py"), "-j", String(Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism())],
      env: { ...bunEnv, JSC: jsc!, SEMA: sema! },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([script.stdout.text(), script.stderr.text(), script.exited]);
    const expected = readFileSync(join(import.meta.dir, "shell", "dropped-protections-expected.txt"), "utf8")
      .split("\n")
      .map(line => line.split("#")[0].trimEnd())
      .filter(line => line !== "");
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(line => line !== "")).toEqual(expected);
    expect(exitCode).toBe(0);
  },
  290_000,
);
