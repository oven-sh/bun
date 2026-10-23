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
//
// json-parse-*.test.ts name the programs that parse by a type while the collector runs, and ask for a collection at every such
// allocation, or at every second: there none may run out of time.
//   JSC=.. TESTAOT=.. FRONT_END=.. PLAIN=.. python3 test/aot/shell/collector-stress.py [--young] strings/search     one program
import { expect, test } from "bun:test";
import { isASAN, isDebug, isLinux } from "harness";
import { availableParallelism } from "os";
import { join } from "path";
import { partInShare, unsupported } from "../run-programs";
import { python, scriptEnvironment, scriptSkipReason } from "../shell/tools";

export function collectorStress(collections: "full" | "young", part: number, parts: number) {
  const skipReason = scriptSkipReason ?? (isLinux && process.arch === "x64" ? undefined : "it is run on Linux x64, which shows the most");
  if (skipReason && !unsupported) console.error(`SKIPPED: test/aot/collector-stress/${collections}-${part}.test.ts: ${skipReason}`);

  test.skipIf(!!skipReason)(
    `the programs answer the same under ${collections} collections all the time (part ${part} of ${parts})`,
    async () => {
      const share = isDebug || isASAN ? `${part}/${parts * (isDebug ? 10 : 3)}` : partInShare(part, parts, 40);
      await using script = Bun.spawn({
        cmd: [python!, join(import.meta.dir, "..", "shell", "collector-stress.py"), "-j", String(Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism()), ...(collections === "young" ? ["--young"] : []), "--part", share, "all"],
        env: scriptEnvironment(),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([script.stdout.text(), script.stderr.text(), script.exited]);
      const lines = stdout.split("\n").filter(line => line !== "");
      expect(stderr).toBe("");
      expect(lines.at(-1)).toMatch(/^[1-9][0-9]* programs, [0-9]+ fail under stress alone, [0-9]+ run out of time$/);
      expect(lines.slice(0, -1)).toEqual([]);
      expect(exitCode).toBe(0);
    },
    isASAN ? 560_000 : 290_000,
  );
}

export function collectorStressOn(collections: "full" | "young", every: 1 | 2 | 3, programs: string[]) {
  const frequency = ["every", "every second", "every third"][every - 1] + " allocation that leaves the fast path";
  const skipReason =
    scriptSkipReason ?? (!isLinux || process.arch !== "x64" ? "it is run on Linux x64, which shows the most" : isASAN || isDebug ? "this build is too slow for a collection at every allocation" : undefined);
  if (skipReason && !unsupported) console.error(`SKIPPED: ${programs.length} programs with a ${collections} collection at ${frequency}: ${skipReason}`);

  test.skipIf(!!skipReason)(
    `${programs.length} programs answer the same with a ${collections} collection at ${frequency}`,
    async () => {
      await using script = Bun.spawn({
        cmd: [python!, join(import.meta.dir, "..", "shell", "collector-stress.py"), "-j", String(Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism()), ...(collections === "young" ? ["--young"] : []), "--every", String(every), ...programs],
        env: scriptEnvironment(),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([script.stdout.text(), script.stderr.text(), script.exited]);
      expect(stderr).toBe("");
      expect(stdout.split("\n").filter(line => line !== "")).toEqual([`${programs.length} programs, 0 fail under stress alone, 0 run out of time`]);
      expect(exitCode).toBe(0);
    },
    290_000,
  );
}
