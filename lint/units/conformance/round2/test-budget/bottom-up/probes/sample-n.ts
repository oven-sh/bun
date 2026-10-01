// For each modulus n of the sample of cases: the cases of each suite, the lines, and how many of the ten reasons of a skip the sample holds.
import { readFileSync } from "node:fs";
import { caseBaseName, listCases } from "/tmp/test-budget-1a/repo/test/cli/lint/conformance/runner";
const root = "/tmp/test-budget-1a/repo/test/cli/lint/conformance";
const paths = listCases(`${root}/corpus/cases`);
const byName = new Map(paths.map(p => [p.slice(p.lastIndexOf("/") + 1), p]));
const key = (reason: string) => reason.replace(/^(unsupported (?:baseUrl|outFile)) .*/, "$1");
const rows = readFileSync(`${root}/fixtures/instances.tsv`, "utf8").split("\n").slice(0, -1).map(line => {
  const [name, kind, reason] = line.split("\t");
  return { path: byName.get(caseBaseName(name))!, k: kind === "skipped" ? key(reason) : kind };
});
const crc = new Map(paths.map(p => [p, Bun.hash.crc32(p)]));
const reasons = new Set(rows.map(r => r.k).filter(k => k !== "E" && k !== "C"));
for (let n = 20; n <= 60; n++) {
  const sample = new Set(paths.filter(p => crc.get(p)! % n === 0));
  const got = new Map<string, number>();
  let lines = 0;
  for (const r of rows) if (sample.has(r.path)) { lines++; got.set(r.k, (got.get(r.k) ?? 0) + 1); }
  const missing = [...reasons].filter(k => !got.has(k));
  const compiler = [...sample].filter(p => p.startsWith("compiler/")).length;
  console.log(`n ${n}: cases ${sample.size} (compiler ${compiler}, conformance ${sample.size - compiler}), lines ${lines}, reasons ${reasons.size - missing.length} of ${reasons.size}${missing.length ? "; none of: " + missing.map(m => m.replace("unsupported ", "").replace(" is unsupported", "")).join(", ") : ""}`);
}
