// usage: <bun> describetime.ts <tree>: the CPU time of the main thread for what conformance.test.ts computes in the bodies of describe.
import { readdirSync, readFileSync } from "node:fs";
const tree = process.argv[2];
const H = `${tree}/test/cli/lint/conformance`;
const cpu = () => Number(readFileSync("/proc/thread-self/schedstat", "latin1").split(" ")[0]) / 1e6;
let t = cpu();
const step = (label: string) => { const n = cpu(); console.log(`${String(Math.round(n - t)).padStart(6)} ms  ${label}`); t = cpu(); };
const runner = await import(`${H}/runner/index.ts`);
await import(`${H}/runner/check_bun_lint.ts`);
await import(`${H}/runner/diagnosticwriter.ts`);
await import(`${H}/runner/error_baseline.ts`);
const rt = await import(`${H}/runner/roundtrip.ts`);
await import(`${H}/runner/tsc_plain_format.ts`);
step("the imports of the runner");
const corpusRoot = `${H}/corpus`;
const cases = new Map<string, string>();
const walk = (rel: string) => {
  for (const entry of readdirSync(`${corpusRoot}/cases/${rel}`, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
    else if (/\.tsx?$/.test(entry.name)) cases.set(entry.name, `${rel}/${entry.name}`);
  }
};
walk("compiler");
walk("conformance");
step(`enumerator: cases(), ${cases.size} names`);
const sampled = (name: string, n: number) => Bun.hash.crc32(name) % n === 0;
const s40 = [...cases.values()].filter(path => sampled(path, 40)).sort();
step(`enumerator: the sample of one in 40 (${s40.length})`);
const files = [
  ...rt.listErrorBaselines(`${corpusRoot}/baselines/typescript`, "typescript"),
  ...rt.listErrorBaselines(`${corpusRoot}/baselines/typescript-go/compiler`, "typescript-go"),
  ...rt.listErrorBaselines(`${corpusRoot}/baselines/typescript-go/conformance`, "typescript-go"),
];
step(`error baselines: listErrorBaselines of three directories (${files.length} names)`);
const pretty = ["deeplyNestedAssignabilityIssue.errors.txt", "prettyFileWithErrorsAndTabs.errors.txt"];
const sample = rt.sampleErrorBaselines(files, 200, { always: pretty, maxBytes: 64 * 1024 });
step(`error baselines: sampleErrorBaselines (${sample.length} files)`);
const s250 = [...cases.values()].filter(path => sampled(path, 250)).sort();
step(`run: the sample of one in 250 (${s250.length})`);
const lists = runner.parseExpectations(readFileSync(`${H}/expectations.json`, "utf8"));
runner.sampleListed(lists, Infinity);
step("expectations.json: read, parsed, sampled");
