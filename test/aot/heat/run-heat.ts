// shell/heat.py as tests. The programs under ../programs are compiled once more as if every function were hot, once more as if every
// function were cold, and once more as if none were either, and run in the `jsc` shell. The compiler has forms for hot code and forms for the
// coldest part of a large program. A test program is too small to have a coldest part, and all its functions are among the hottest, so as it
// stands it meets neither the cold forms nor those that most of a large program is compiled in.
//
// All programs take an hour of one processor with every function hot and three quarters of an hour with every function cold, so each is dealt out to eight files. ../shell/tools.ts says what it
// needs. A sanitizer or debug build takes a tenth of each file's programs.
//   JSC=.. SEMA=.. PLAIN=.. python3 test/aot/shell/heat.py hot calls/members-called-by-signature     one program
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { availableParallelism } from "os";
import { join } from "path";
import { unsupported } from "../run-programs";
import { jsc, python, sema, whyNoScriptRuns } from "../shell/tools";

export function heat(which: "hot" | "cold" | "neither", part: number, parts: number) {
  if (whyNoScriptRuns && !unsupported) console.error(`SKIPPED: test/aot/heat/${which}-${part}.test.ts: ${whyNoScriptRuns}`);

  test.skipIf(!!whyNoScriptRuns)(
    `the programs answer the same with every function ${which} (part ${part} of ${parts})`,
    async () => {
      await using forced = Bun.spawn({
        cmd: [python!, join(import.meta.dir, "..", "shell", "heat.py"), "-j", String(Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism()), "--part", `${part}/${isASAN || isDebug ? parts * 10 : parts}`, which, "all"],
        env: { ...bunEnv, JSC: jsc!, SEMA: sema!, PLAIN: bunExe() },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([forced.stdout.text(), forced.stderr.text(), forced.exited]);
      const lines = stdout.split("\n").filter(line => line !== "");
      expect(stderr).toBe("");
      expect(lines.at(-1)).toMatch(/^[1-9][0-9]* programs answer the same with every function (hot|cold|neither), [0-9]+ do not$/);
      expect(lines.slice(0, -1)).toEqual([]);
      expect(exitCode).toBe(0);
    },
    290_000,
  );
}
