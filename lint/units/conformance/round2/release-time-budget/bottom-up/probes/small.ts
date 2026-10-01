// usage: <bun> small.ts <runner directory>: what a debug build pays for the samples of the test file: enumerateCase over one case in 40 and one in 250.
import { readdirSync, readFileSync } from "node:fs";
const runnerDir = process.argv[2];
const casesDir = "/tmp/rtb1a/repo/test/cli/lint/conformance/corpus/cases";
const cpu = () => Number(readFileSync("/proc/thread-self/schedstat", "latin1").split(" ")[0]) / 1e6;
const t0 = cpu();
const cr = await import(`${runnerDir}/compiler_runner.ts`);
const t1 = cpu();
const paths: string[] = [];
const walk = (rel: string) => {
  for (const e of readdirSync(`${casesDir}/${rel}`, { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${rel}/${e.name}`);
    else if (/\.tsx?$/.test(e.name)) paths.push(`${rel}/${e.name}`);
  }
};
walk("compiler");
walk("conformance");
const t2 = cpu();
const sampled = (name: string, n: number) => Bun.hash.crc32(name) % n === 0;
const s40 = paths.filter(p => sampled(p, 40)).sort();
const s250 = paths.filter(p => sampled(p, 250)).sort();
let n40 = 0, n250 = 0;
const t3 = cpu();
for (const p of s40) n40 += cr.enumerateCase(casesDir, p).length;
const t4 = cpu();
for (const p of s250) n250 += cr.enumerateCase(casesDir, p).length;
const t5 = cpu();
console.log(`import ${Math.round(t1 - t0)} ms | walk of ${paths.length} cases ${Math.round(t2 - t1)} ms | one in 40: ${s40.length} cases, ${n40} instances, ${Math.round(t4 - t3)} ms | one in 250: ${s250.length} cases, ${n250} instances, ${Math.round(t5 - t4)} ms (main-thread CPU)`);
