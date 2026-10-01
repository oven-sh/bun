// usage: bun enumjson.ts <runner directory> <cases directory>: one call of enumerateInstances in a fresh process, metered, as one JSON line.
import { sample, delta } from "./meter.ts";
const [runnerDir, casesDir] = process.argv.slice(2);
const s0 = sample();
const { enumerateInstances } = await import(`${runnerDir}/compiler_runner.ts`);
const s1 = sample();
const instances = enumerateInstances(casesDir);
const s2 = sample();
console.log(JSON.stringify({ n: instances.length, import: delta(s0, s1), call: delta(s1, s2) }));
