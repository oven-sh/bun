// usage: bun enum1.ts <repo> [calls]: enumerateInstances, the given number of calls (default 1), metered.
import { sample, delta, fmt } from "./meter.ts";
const repo = process.argv[2];
const calls = Number(process.argv[3] ?? 1);
const H = `${repo}/test/cli/lint/conformance`;
const { enumerateInstances } = await import(`${H}/runner/compiler_runner.ts`);
for (let k = 0; k < calls; k++) {
  const s0 = sample();
  const instances = enumerateInstances(`${H}/corpus/cases`);
  console.log(fmt(`enumerateInstances (${instances.length})`, delta(s0, sample())));
}
