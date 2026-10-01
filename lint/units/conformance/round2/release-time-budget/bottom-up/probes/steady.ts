// usage: bun steady.ts <label> <runner directory> [calls]: the CPU time of the main thread for each call of enumerateInstances in one process.
import { readFileSync } from "node:fs";
const [label, runnerDir, callsArg] = process.argv.slice(2);
const casesDir = "/tmp/rtb1a/repo/test/cli/lint/conformance/corpus/cases";
const cpu = () => Number(readFileSync("/proc/thread-self/schedstat", "latin1").split(" ")[0]) / 1e6;
const { enumerateInstances } = await import(`${runnerDir}/compiler_runner.ts`);
const times: number[] = [];
for (let k = 0; k < Number(callsArg ?? 6); k++) {
  const t = cpu();
  enumerateInstances(casesDir);
  times.push(Math.round(cpu() - t));
}
console.log(`${label}: main-thread CPU per call: ${times.join(" ")} ms; first ${times[0]}, least of the rest ${Math.min(...times.slice(1))}`);
