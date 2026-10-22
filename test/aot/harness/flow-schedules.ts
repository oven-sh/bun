// For ../flow-schedules.test.ts and ../servers/schedules.test.ts: one program built under the usual schedule of flow's rules and under three others.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";

export const schedules: Record<string, string[]> = {
  usual: [],
  first: ["--aot-testing=DelayFlowRules"],
  second: ["--aot-testing=DelayOtherFlowRules"],
  third: ["--aot-testing=DelayFlowRules,DelayOtherFlowRules"],
};
/**
 * Today the code moves by up to 21 percent: the ten lines of a server on node:http took 3.04 MB in the place of 2.51 under the second on the trees of 2026-10-21 03:43. The program that imports
 * eleven modules had 5,000 functions under the usual schedule and 3,900 under the first until 2026-10-21 04:35; since then 4,004 | 4,016 | 4,000 | 3,999. Lower it as the rest is cured; never raise it.
 */
export const mostSpread = 0.25;

export async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, errors: stderr.split("\n").filter(line => line.startsWith("error")), exitCode };
}

export async function buildUnderEachSchedule(name: string, directory: string, entry: string, flags: string[] = []) {
  const built = await Promise.all(
    Object.entries(schedules).map(async ([schedule, switches]) => {
      const executable = join(directory, `${name}-${schedule}${isWindows ? ".exe" : ""}`);
      const report = join(directory, `${name}-${schedule}.report.json`);
      const result = await run([bunExe(), "build", "--compile", "--aot", ...flags, ...switches, "--aot-report=" + report, entry, "--outfile", executable], directory);
      expect({ schedule, errors: result.errors, exitCode: result.exitCode }).toEqual({ schedule, errors: [], exitCode: 0 });
      const { summary } = (await Bun.file(report).json()) as { summary: { codeBytes: number; functions: number } };
      return { schedule, executable, codeBytes: summary.codeBytes, functions: summary.functions };
    }),
  );
  const usual = built[0];
  console.log(`SCHEDULES ${name}: code ${built.map(it => it.codeBytes).join(" | ")} B, functions ${built.map(it => it.functions).join(" | ")} (${Object.keys(schedules).join(" | ")})`);
  for (const other of built.slice(1)) {
    const spread = Math.abs(other.codeBytes - usual.codeBytes) / usual.codeBytes;
    expect({ schedule: other.schedule, codeBytes: other.codeBytes, usual: usual.codeBytes, within: spread <= mostSpread }).toEqual({
      schedule: other.schedule,
      codeBytes: other.codeBytes,
      usual: usual.codeBytes,
      within: true,
    });
  }
  return built;
}
