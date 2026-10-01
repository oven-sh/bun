// usage: <bun> describe-time.ts <H>: what conformance.test.ts does while its describe blocks are read, part by part.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const home = process.argv[2];
let c0 = process.cpuUsage();
let t0 = performance.now();
let sumCpu = 0;
const part = (name: string, value: unknown) => {
  const c = process.cpuUsage(c0);
  sumCpu += c.user + c.system;
  console.log(`${name.padEnd(58)} wall ${(performance.now() - t0).toFixed(0).padStart(6)} ms, user+sys ${((c.user + c.system) / 1000).toFixed(0).padStart(6)} ms  ${JSON.stringify(value)}`);
  c0 = process.cpuUsage();
  t0 = performance.now();
};
const runner = await import(join(home, "runner"));
const { listErrorBaselines, sampleErrorBaselines } = await import(join(home, "runner/roundtrip"));
await import(join(home, "runner/check_bun_lint"));
await import(join(home, "runner/diagnosticwriter"));
await import(join(home, "runner/error_baseline"));
await import(join(home, "runner/tsc_plain_format"));
part("import of the runner modules", Object.keys(runner).length);
const corpusRoot = join(home, "corpus");
const sampled = (name: string, n: number) => Bun.hash.crc32(name) % n === 0;
const cases = new Map<string, string>();
const walk = (rel: string) => {
  for (const entry of readdirSync(`${corpusRoot}/cases/${rel}`, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
    else if (/\.tsx?$/.test(entry.name)) cases.set(entry.name, `${rel}/${entry.name}`);
  }
};
walk("compiler");
walk("conformance");
part("enumerator: cases(), the walk of 386 directories", cases.size);
const s40 = [...cases.values()].filter(path => sampled(path, 40)).sort();
part("enumerator: the sample of one case in 40", s40.length);
const listed = [
  ...listErrorBaselines(`${corpusRoot}/baselines/typescript`, "typescript"),
  ...listErrorBaselines(`${corpusRoot}/baselines/typescript-go/compiler`, "typescript-go"),
  ...listErrorBaselines(`${corpusRoot}/baselines/typescript-go/conformance`, "typescript-go"),
];
part("error baselines: listErrorBaselines of three directories", listed.length);
const sample = sampleErrorBaselines(listed, 200, {
  always: ["deeplyNestedAssignabilityIssue.errors.txt", "prettyFileWithErrorsAndTabs.errors.txt"],
  maxBytes: 64 * 1024,
});
part("error baselines: sampleErrorBaselines", sample.length);
const s250 = [...cases.values()].filter(path => sampled(path, 250)).sort();
part("run: the sample of one case in 250", s250.length);
const text = readFileSync(join(home, "expectations.json"), "utf8");
const lists = runner.parseExpectations(text);
const names = runner.sampleListed(lists, Infinity);
part("expectations.json: read, parsed, sampled", names.length);
const both = new Set([...s40, ...s250]);
console.log(`in all: user+sys ${(sumCpu / 1000).toFixed(0)} ms; cases in either sample ${both.size}`);
