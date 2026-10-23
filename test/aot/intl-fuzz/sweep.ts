// Runs the fuzzer at full size: see README.md. Every part of the sweep, or some of them, each built with
// `bun build --compile --aot` and run, in parallel.
//
//   bun test/aot/intl-fuzz/sweep.ts [--bun=<the Bun under test: this one>] [--jobs=<n: one a processor>]
//                                   [--first=<part: 0>] [--parts=<n: all>] [--random=<n programs with options drawn at random: 0>]
//
// Each executable runs three times: as it is; as if its patterns were made by another ICU, so that each is planned again when it is
// first used; and as if no plan could be made, so that ICU formats everything.
// The exit code is 1 if a text differs, if the build's own comparison with ICU refuses a plan, or if fewer formatters than expected
// have a pattern.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { expectedShareWithAPattern, generateProgram, generateSweepProgram, numberOfSweepPrograms } from "./generate";
import { run } from "../harness/run";

const flag = (name: string, otherwise: string) => process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3) ?? otherwise;
const bun = flag("bun", process.execPath);
const jobs = Number(flag("jobs", String(availableParallelism())));
const first = Number(flag("first", "0"));
const parts = Math.min(Number(flag("parts", String(numberOfSweepPrograms()))), numberOfSweepPrograms() - first);
const random = Number(flag("random", "0"));

export const waysToRun = { "as built": "0", "planned again": "1", "no plan": "2" } as const;

export type Outcome = { formatters: number; withAPattern: number; refused: number; comparisons: number; differences: number; said: string[] };

export async function buildAndRun(bunUnderTest: string, name: string, program: string, env: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1" }): Promise<Outcome> {
  const outcome: Outcome = { formatters: 0, withAPattern: 0, refused: 0, comparisons: 0, differences: 0, said: [] };
  const dir = mkdtempSync(join(tmpdir(), "aot-intl-sweep-"));
  try {
    writeFileSync(join(dir, "main.ts"), program);
    const executable = join(dir, process.platform === "win32" ? "main.exe" : "main");
    const built = await run([bunUnderTest, "build", "--compile", "--aot", "--explain=statistics", "main.ts", "--outfile", executable], dir, env);
    const statistics = new Map(Array.from(built.stderr.matchAll(/^(\w+) (\d+)$/gm), ([, statistic, value]) => [statistic, Number(value)] as const));
    const counts = ["ConstantFormatterRequests", "FormatPatternsCreated", "FormatPatternsRejectedByCheck"].map(statistic => statistics.get(statistic));
    if (built.exitCode || counts.includes(undefined)) {
      outcome.differences++;
      outcome.said.push(`${name}: the build: exit code ${built.exitCode}: ${built.stderr.trim().split("\n").slice(-3).join(" | ")}`);
      return outcome;
    }
    [outcome.formatters, outcome.withAPattern, outcome.refused] = counts as number[];
    if (statistics.get("MaxConstantFormatterRequestsHits")) outcome.said.push(`${name}: the build reached the limit MaxConstantFormatterRequests, so some formatters were not planned`);
    for (const [way, value] of Object.entries(waysToRun)) {
      const ran = await run([executable], dir, { ...env, BUN_JSC_formatPatternsOfAnotherICUForTesting: value });
      const result = /^(\d+) comparisons, (\d+) differences$/m.exec(ran.stdout);
      if (ran.exitCode || ran.stderr || !result) {
        outcome.differences++;
        outcome.said.push(`${name}, ${way}: exit code ${ran.exitCode}: ${(ran.stderr || ran.stdout).trim().split("\n").slice(-3).join(" | ")}`);
        continue;
      }
      outcome.comparisons += Number(result[1]);
      outcome.differences += Number(result[2]);
      outcome.said.push(...ran.stdout.split("\n").filter(line => line.startsWith("DIFFERENT")).map(line => `${name}, ${way}: ${line}`));
    }
    return outcome;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const work: [string, () => string][] = [];
  for (let part = first; part < first + parts; part++) work.push([`part ${part}`, () => generateSweepProgram(part)]);
  for (let seed = 1; seed <= random; seed++) work.push([`seed ${seed}`, () => generateProgram(seed)]);
  const total: Outcome = { formatters: 0, withAPattern: 0, refused: 0, comparisons: 0, differences: 0, said: [] };
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, jobs) }, async () => {
      while (next < work.length) {
        const [name, generate] = work[next++];
        const outcome = await buildAndRun(bun, name, generate());
        for (const key of ["formatters", "withAPattern", "refused", "comparisons", "differences"] as const) total[key] += outcome[key];
        for (const line of outcome.said) console.log(line);
        if (++done % 100 === 0) console.error(`${done} of ${work.length}: ${total.comparisons} comparisons, ${total.differences} differences`);
      }
    }),
  );
  const share = total.withAPattern / total.formatters;
  console.log(`${work.length} programs: ${total.formatters} constant formatters, ${total.withAPattern} with a pattern (${(share * 100).toFixed(1)}%), ${total.refused} plans refused by the build's comparison with ICU`);
  console.log(`${total.comparisons} comparisons, ${total.differences} differences`);
  const isWholeSweep = first === 0 && parts === numberOfSweepPrograms();
  if (isWholeSweep && share < expectedShareWithAPattern) console.log(`fewer formatters have a pattern than expected (${(expectedShareWithAPattern * 100).toFixed(1)}%): see README.md`);
  process.exit(total.differences || total.refused || (isWholeSweep && share < expectedShareWithAPattern) ? 1 : 0);
}
