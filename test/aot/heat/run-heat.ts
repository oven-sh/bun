// shell/heat.py as tests. The programs under ../programs are compiled once more as if every function were hot, once more as if every
// function were cold, and once more as if none were either, and run in the `jsc` shell. The compiler has forms for hot code and forms for the
// coldest part of a large program. A test program is too small to have a coldest part, and all its functions are among the hottest, so as it
// stands it meets neither the cold forms nor those that most of a large program is compiled in.
//
// All programs take an hour of one processor with every function hot and three quarters of an hour with every function cold, so each is dealt out to eight files. ../shell/tools.ts says what it
// needs.
//   JSC=.. TESTAOT=.. FRONT_END=.. PLAIN=.. python3 test/aot/shell/heat.py hot calls/members-called-by-signature     one program
import { expect, test } from "bun:test";
import { availableParallelism } from "os";
import { join } from "path";
import { partInShare, unsupported, writeShareOfWrittenPrograms } from "../run-programs";
import { python, scriptEnvironment, scriptSkipReason } from "../shell/tools";

export function heat(heatOverride: "hot" | "cold" | "neither", part: number, parts: number) {
  if (scriptSkipReason && !unsupported) console.error(`SKIPPED: test/aot/heat/${heatOverride}-${part}.test.ts: ${scriptSkipReason}`);

  const share = partInShare(part, parts, 40, true);
  const written = scriptSkipReason ? undefined : writeShareOfWrittenPrograms(share);

  test.skipIf(!!scriptSkipReason)(
    `the programs answer the same with every function ${heatOverride} (part ${part} of ${parts})`,
    async () => {
      await using script = Bun.spawn({
        cmd: [python!, join(import.meta.dir, "..", "shell", "heat.py"), "-j", String(Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism()), "--part", share, heatOverride, "all"],
        env: { ...scriptEnvironment(), WRITTEN: written },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([script.stdout.text(), script.stderr.text(), script.exited]);
      const lines = stdout.split("\n").filter(line => line !== "");
      expect(stderr).toBe("");
      expect(lines.at(-1)).toMatch(/^[1-9][0-9]* programs answer the same with every function (hot|cold|neither), [0-9]+ do not$/);
      expect(lines.slice(0, -1)).toEqual([]);
      expect(exitCode).toBe(0);
    },
    290_000,
  );
}
