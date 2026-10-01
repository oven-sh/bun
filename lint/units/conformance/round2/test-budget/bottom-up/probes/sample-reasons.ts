// What the sample of one case in 40 of conformance.test.ts holds: cases, lines of the list, and the lines of each reason of a skip, beside the whole list.
import { readFileSync } from "node:fs";
import { caseBaseName, listCases } from "/tmp/test-budget-1a/repo/test/cli/lint/conformance/runner";
const root = "/tmp/test-budget-1a/repo/test/cli/lint/conformance";
const paths = listCases(`${root}/corpus/cases`);
const byName = new Map(paths.map(p => [p.slice(p.lastIndexOf("/") + 1), p]));
const sampled = (name: string, n: number) => Bun.hash.crc32(name) % n === 0;
const key = (reason: string) => reason.replace(/^(unsupported (?:baseUrl|outFile)) .*/, "$1");
for (const n of [40, 250]) {
  const sample = new Set(paths.filter(p => sampled(p, n)));
  const all = new Map<string, number>(), inSample = new Map<string, number>();
  let lines = 0, sampleLines = 0;
  for (const line of readFileSync(`${root}/fixtures/instances.tsv`, "utf8").split("\n").slice(0, -1)) {
    const [name, kind, reason] = line.split("\t");
    const k = kind === "skipped" ? key(reason) : kind;
    const path = byName.get(caseBaseName(name))!;
    lines++;
    all.set(k, (all.get(k) ?? 0) + 1);
    if (!sample.has(path)) continue;
    sampleLines++;
    inSample.set(k, (inSample.get(k) ?? 0) + 1);
  }
  console.log(`one case in ${n}: ${sample.size} of ${paths.length} cases, ${sampleLines} of ${lines} lines`);
  for (const [k, v] of [...all].sort((a, b) => b[1] - a[1])) console.log(`  ${String(inSample.get(k) ?? 0).padStart(5)} of ${String(v).padStart(5)}  ${k}`);
}
