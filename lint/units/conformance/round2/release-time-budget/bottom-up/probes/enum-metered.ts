// usage: bun enum-metered.ts <repo> [n]
import { sample, delta, fmt } from "./meter.ts";
const repo = process.argv[2];
const n = Number(process.argv[3] ?? 3);
const H = `${repo}/test/cli/lint/conformance`;
const s0 = sample();
const { enumerateInstances } = await import(`${H}/runner/compiler_runner.ts`);
const s1 = sample();
console.log(fmt("import compiler_runner.ts", delta(s0, s1)));
let prev = s1;
for (let k = 0; k < n; k++) {
  const instances = enumerateInstances(`${H}/corpus/cases`);
  const s = sample();
  console.log(fmt(`enumerateInstances call ${k + 1} (${instances.length})`, delta(prev, s)));
  prev = s;
}
