// shell/bad-time.py as tests. The programs under ../programs run in the `jsc` shell, and at the end of each the shell is asked
// whether its realm "is having a bad time": every array in storage that nothing reads or writes in place, for good. The answers stay
// right, so no other test sees it. shell/bad-time-known.txt lists the programs that mean it.
//
// All programs take three quarters of an hour of one processor, so they are dealt out to eight files. ../shell/tools.ts says what
// it needs. A sanitizer or debug build takes a tenth of each file's programs.
//   JSC=.. SEMA=.. PLAIN=.. python3 test/aot/shell/bad-time.py arrays/holes     one program
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { availableParallelism } from "os";
import { join } from "path";
import { unsupported } from "../run-programs";
import { jsc, python, sema, whyNoScriptRuns } from "../shell/tools";

export function badTime(part: number, parts: number) {
  if (whyNoScriptRuns && !unsupported) console.error(`SKIPPED: test/aot/bad-time/bad-time-${part}.test.ts: ${whyNoScriptRuns}`);

  test.skipIf(!!whyNoScriptRuns)(
    `no program ends with a bad time unless it means it (part ${part} of ${parts})`,
    async () => {
      await using asked = Bun.spawn({
        cmd: [python!, join(import.meta.dir, "..", "shell", "bad-time.py"), "-j", String(Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism()), "--part", `${part}/${isASAN || isDebug ? parts * 10 : parts}`, "all"],
        env: { ...bunEnv, JSC: jsc!, SEMA: sema!, PLAIN: bunExe() },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([asked.stdout.text(), asked.stderr.text(), asked.exited]);
      const lines = stdout.split("\n").filter(line => line !== "");
      expect(stderr).toBe("");
      expect(lines.at(-1)).toMatch(/^[1-9][0-9]* programs reach their end, /);
      expect(lines.filter(line => line.endsWith(": has a bad time"))).toEqual([]);
      expect(exitCode).toBe(0);
    },
    290_000,
  );
}
