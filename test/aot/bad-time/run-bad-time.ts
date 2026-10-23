// shell/bad-time.py as tests. The programs under ../programs run in the `jsc` shell, and at the end of each the shell is asked
// whether its realm "is having a bad time": every array in storage that nothing reads or writes in place, for good. The answers stay
// right, so no other test sees it. shell/bad-time-known.txt lists the programs that mean it.
//
// All programs take three quarters of an hour of one processor, so they are dealt out to eight files. ../shell/tools.ts says what
// it needs.
//   JSC=.. TESTAOT=.. FRONT_END=.. PLAIN=.. python3 test/aot/shell/bad-time.py arrays/holes     one program
import { expect, test } from "bun:test";
import { availableParallelism } from "os";
import { join } from "path";
import { partInShare, unsupported, writeShareOfWrittenPrograms } from "../run-programs";
import { python, scriptEnvironment, scriptSkipReason } from "../shell/tools";
import { run } from "../harness/run";

export function badTime(part: number, parts: number) {
  if (scriptSkipReason && !unsupported) console.error(`SKIPPED: test/aot/bad-time/bad-time-${part}.test.ts: ${scriptSkipReason}`);

  const share = partInShare(part, parts, 40, true);
  const written = scriptSkipReason ? undefined : writeShareOfWrittenPrograms(share);

  test.skipIf(!!scriptSkipReason)(
    `no program ends with a bad time unless it means it (part ${part} of ${parts})`,
    async () => {
      const { stdout, stderr, exitCode } = await run([python!, join(import.meta.dir, "..", "shell", "bad-time.py"), "-j", String(Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism()), "--part", share, "all"], undefined, { ...scriptEnvironment(), WRITTEN: written });
      const lines = stdout.split("\n").filter(line => line !== "");
      expect(stderr).toBe("");
      expect(lines.at(-1)).toMatch(/^[1-9][0-9]* programs reach their end, /);
      expect(lines.filter(line => line.endsWith(": has a bad time"))).toEqual([]);
      expect(exitCode).toBe(0);
    },
    290_000,
  );
}
