// The body of the whole-corpus test and what runs at describe time, phase by phase, outside the test runner.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { read, delta, type Reading } from "./meter";
const home = process.argv[2] ?? "/tmp/rtb1b/repo/test/cli/lint/conformance";
const rounds = Number(process.argv[3] ?? 1);
let last: Reading = read();
const phase = (name: string) => {
  const now = read();
  console.log(`${name.padEnd(44)} ${delta(last, now)}`);
  last = read();
};
const runner = await import(join(home, "runner"));
const { compareStrings } = await import(join(home, "runner/gostrings"));
const { listErrorBaselines, sampleErrorBaselines } = await import(join(home, "runner/roundtrip"));
phase("import the runner modules");
const corpusRoot = join(home, "corpus");
const fixtures = join(home, "fixtures");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const sampled = (name: string, n: number) => Bun.hash.crc32(name) % n === 0;

for (let round = 0; round < rounds; round++) {
  console.log(`--- round ${round}`);
  last = read();
  // describe time
  const cases = new Map<string, string>();
  const walk = (rel: string) => {
    for (const entry of readdirSync(`${corpusRoot}/cases/${rel}`, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
      else if (/\.tsx?$/.test(entry.name)) cases.set(entry.name, `${rel}/${entry.name}`);
    }
  };
  walk("compiler");
  walk("conformance");
  phase("describe: cases() walk");
  const s40 = [...cases.values()].filter(path => sampled(path, 40)).sort();
  const s250 = [...cases.values()].filter(path => sampled(path, 250)).sort();
  phase(`describe: samples 1/40 (${s40.length}) and 1/250 (${s250.length})`);
  const listed = [
    ...listErrorBaselines(`${corpusRoot}/baselines/typescript`, "typescript"),
    ...listErrorBaselines(`${corpusRoot}/baselines/typescript-go/compiler`, "typescript-go"),
    ...listErrorBaselines(`${corpusRoot}/baselines/typescript-go/conformance`, "typescript-go"),
  ];
  phase(`describe: listErrorBaselines (${listed.length})`);
  const sample = sampleErrorBaselines(listed, 200, {
    always: ["deeplyNestedAssignabilityIssue.errors.txt", "prettyFileWithErrorsAndTabs.errors.txt"],
    maxBytes: 64 * 1024,
  });
  phase(`describe: sampleErrorBaselines (${sample.length})`);

  // the whole-corpus test
  const corpus = runner.openCorpus(corpusRoot);
  const reference = JSON.parse(readFileSync(join(home, "reference_counts.json"), "utf8"));
  const listText = readFileSync(join(fixtures, "instances.tsv"), "utf8");
  const listLines = listText.split("\n").slice(0, -1);
  phase("read the list and the counts");
  const instances = corpus.enumerateInstances();
  phase(`corpus().enumerateInstances() (${instances.length})`);
  const lineOf = (i: any) => (i.status === "run" ? `${i.name}\t${i.oracle.class}` : `${i.name}\tskipped\t${i.skipReason}`);
  const got = new Set(instances.map(lineOf));
  const want = new Set(listLines);
  const diff = { a: [...got].filter(l => !want.has(l)).length, b: [...want].filter(l => !got.has(l)).length };
  phase(`lines against the list (${diff.a}, ${diff.b})`);
  const count = (f: (i: any) => boolean) => instances.filter(f).length;
  const run = (i: any) => i.status === "run";
  const caseBaseName = (instanceName: string) => {
    const m = /^(.*)\(([^()]*)\)(\.tsx?)$/s.exec(instanceName);
    return m === null ? instanceName : m[1] + m[3];
  };
  const suite = (s: string) => {
    const of = (f: (i: any) => boolean) => count(i => i.suite === s && f(i));
    return { instances: of(() => true), run: of(run), skipped: of(i => !run(i)), E: of(i => run(i) && i.oracle.class === "E"), C: of(i => run(i) && i.oracle.class === "C") };
  };
  const counts = {
    instances: instances.length, run: count(run), skipped: count(i => !run(i)),
    E: count(i => run(i) && i.oracle.class === "E"), C: count(i => run(i) && i.oracle.class === "C"),
    cases: new Set(instances.map((i: any) => caseBaseName(i.name))).size,
    compiler: suite("compiler"), conformance: suite("conformance"),
    accepted: count(i => run(i) && i.accepted), triaged: count(i => run(i) && i.triaged),
    typescriptGo: count(i => run(i) && i.oracle.source === "typescript-go"), typescript: count(i => run(i) && i.oracle.source === "typescript"),
  };
  phase("counts");
  const goName = (name: string) => {
    const m = /^(.*)\(([^()]*)\)(\.tsx?)$/s.exec(name);
    return m === null ? name : `${m[1]}${m[3]}_${m[2]}`;
  };
  const subtests = instances.map((i: any) => `${run(i) ? "PASS" : "SKIP"}\t${goName(i.name)}`).sort((a: string, b: string) => compareStrings(a.slice(5), b.slice(5))).map((l: string) => l + "\n").join("");
  const reasons = instances.filter((i: any) => !run(i)).map((i: any) => `${goName(i.name)}\t${i.skipReason}`).sort(compareStrings).map((l: string) => l + "\n").join("");
  const digests = { subtests: instances.length, sha256: sha256(subtests), skipReasonsSha256: sha256(reasons) };
  phase("digests of the run");
  console.log(JSON.stringify({ instances: counts.instances, run: counts.run, skipped: counts.skipped, E: counts.E, C: counts.C, same: digests.sha256 === reference.suiteRun?.sha256 && digests.skipReasonsSha256 === reference.suiteRun?.skipReasonsSha256 }));
}
