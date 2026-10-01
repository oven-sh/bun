// usage: bun threads.ts <runner directory> [calls]: the CPU time of every thread of the process after enumerateInstances, by the name of the thread.
import { readdirSync, readFileSync } from "node:fs";
const [runnerDir, callsArg] = process.argv.slice(2);
const casesDir = "/tmp/rtb1a/repo/test/cli/lint/conformance/corpus/cases";
const threads = () => {
  const out = new Map<string, number>();
  for (const tid of readdirSync("/proc/self/task")) {
    try {
      const comm = readFileSync(`/proc/self/task/${tid}/comm`, "latin1").trim();
      const on = Number(readFileSync(`/proc/self/task/${tid}/schedstat`, "latin1").split(" ")[0]) / 1e6;
      out.set(comm, (out.get(comm) ?? 0) + on);
    } catch {}
  }
  return out;
};
const { enumerateInstances } = await import(`${runnerDir}/compiler_runner.ts`);
const before = threads();
for (let k = 0; k < Number(callsArg ?? 1); k++) enumerateInstances(casesDir);
const after = threads();
const rows = [...after].map(([name, ms]) => [name, Math.round(ms - (before.get(name) ?? 0))] as const).filter(r => r[1] > 0).sort((a, b) => b[1] - a[1]);
console.log(rows.map(([n, ms]) => `${n}: ${ms} ms`).join(" | "), "| total", rows.reduce((a, r) => a + r[1], 0), "ms");
