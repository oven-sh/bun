// shell/collector-stress.py as tests. The programs under ../programs run in the `jsc` shell twice: as they are, and with a
// collection at every third allocation that leaves the fast path, every freed cell overwritten. A value that compiled code
// still uses and the collector cannot find is then gone at once, every time, instead of once in a million runs. With young
// collections the same shows a store of a new cell into an old one that compiled code makes without a write barrier.
//
// All programs take three hours of one processor under full collections and an hour and a half under young ones, so each is dealt out to
// many files: full-<n>.test.ts and young-<n>.test.ts take every thirtieth and every twentieth program. CI gives a file five
// minutes on four processors: when the files pass three, deal the programs out to more.
//
// ../shell/tools.ts says what it needs. Linux x64 only: with fewer registers, fewer stale copies of a pointer lie
// about that would keep a value alive by accident. A build with a sanitizer takes a third of each file's programs, a debug build a tenth.
//   JSC=.. SEMA=.. PLAIN=.. python3 test/aot/shell/collector-stress.py [--young] strings/search     one program
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux } from "harness";
import { availableParallelism } from "os";
import { join } from "path";
import { unsupported } from "../run-programs";
import { jsc, python, sema, whyNoScriptRuns } from "../shell/tools";

export function collectorStress(collections: "full" | "young", part: number, parts: number) {
  const whySkipped = whyNoScriptRuns ?? (isLinux && process.arch === "x64" ? undefined : "it is run on Linux x64, which shows the most");
  if (whySkipped && !unsupported) console.error(`SKIPPED: test/aot/collector-stress/${collections}-${part}.test.ts: ${whySkipped}`);

  test.skipIf(!!whySkipped)(
    `the programs answer the same under ${collections} collections all the time (part ${part} of ${parts})`,
    async () => {
      const share = `${part}/${parts * (isDebug ? 10 : isASAN ? 3 : 1)}`;
      await using stress = Bun.spawn({
        cmd: [python!, join(import.meta.dir, "..", "shell", "collector-stress.py"), "-j", String(Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism()), ...(collections === "young" ? ["--young"] : []), "--part", share, "all"],
        env: { ...bunEnv, JSC: jsc!, SEMA: sema!, PLAIN: bunExe() },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([stress.stdout.text(), stress.stderr.text(), stress.exited]);
      const lines = stdout.split("\n").filter(line => line !== "");
      expect(stderr).toBe("");
      expect(lines.at(-1)).toMatch(/^[1-9][0-9]* programs, [0-9]+ fail under stress alone, [0-9]+ run out of time$/);
      expect(lines.slice(0, -1)).toEqual([]);
      expect(exitCode).toBe(0);
    },
    isASAN ? 560_000 : 290_000,
  );
}
