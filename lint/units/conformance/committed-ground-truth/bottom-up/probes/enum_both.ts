// Enumerates every instance with the assembled runner against two layouts and prints counts and digests.
// usage: bun enum_both.ts <assembled runner set> <committed layout root (the directory that holds corpus/)> <out dir>
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const [asm, home, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const R = await import(asm + "/test/cli/lint/conformance/runner/index.ts");
const G = await import(asm + "/test/cli/lint/conformance/runner/gostrings.ts");
const B = await import(asm + "/test/cli/lint/conformance/runner/baseline.ts");
const notes = "/workspace/notes/lint/units/conformance";
const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
const cpu = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};

const reference = R.referenceLayout();
const committed = {
  casesRoot: home + "/corpus/ts/tests/cases",
  libRoot: home + "/corpus/ts/tests/lib",
  tsgoBaselines: home + "/corpus/tsgo/testdata/baselines/reference/submodule",
  tsBaselines: home + "/corpus/ts/tests/baselines/reference",
  expectsNoErrors: home + "/corpus/tsgo.expects-no-errors.txt",
  accepted: home + "/corpus/tsgo/testdata/submoduleAccepted.txt",
  triaged: home + "/corpus/tsgo/testdata/submoduleTriaged.txt",
  postEmitOrder: reference.postEmitOrder,
};

const goLines = gunzipSync(readFileSync(notes + "/oracle-and-expectations/bottom-up/vectors/go-subtests.tsv.gz"))
  .toString("utf8")
  .split("\n")
  .filter(l => l !== "");
const goStatus = new Map<string, string>(goLines.map(l => [l.slice(5), l.slice(0, 4)]));

const norm = (reason: string) => reason.replace(/^(unsupported (?:baseUrl|outFile)) .*/, "$1");
const result: Record<string, any> = {};
for (const [label, layout] of [
  ["reference", reference],
  ["committed", committed],
] as const) {
  const t0 = performance.now();
  const c0 = cpu();
  const corpus = R.loadCorpus(layout);
  const tLoad = performance.now() - t0;
  const cLoad = cpu() - c0;
  const t1 = performance.now();
  const c1 = cpu();
  const e = R.enumerateInstances({ casesRoot: layout.casesRoot });
  const tEnum = performance.now() - t1;
  const cEnum = cpu() - c1;
  const t2 = performance.now();
  const c2 = cpu();
  const facts = e.instances.map((i: any) => R.factsOf(corpus, i));
  const sources = e.instances.map((i: any) => (i.status === "run" ? B.oracleOf(corpus, i.suite, i.name).source : ""));
  const tFacts = performance.now() - t2;
  const cFacts = cpu() - c2;

  const names = new Set(facts.map((f: any) => f.name));
  const count = (f: (x: any) => boolean) => facts.filter(f).length;
  const reasons: Record<string, number> = {};
  for (const f of facts) if (f.status !== "run") reasons[norm(f.reason)] = (reasons[norm(f.reason)] ?? 0) + 1;
  const bySource: Record<string, number> = {};
  for (const s of sources) if (s !== "") bySource[s] = (bySource[s] ?? 0) + 1;
  const bySuite: Record<string, any> = {};
  for (const suite of ["compiler", "conformance"]) {
    const of = (f: (x: any) => boolean) => facts.filter((x: any) => x.casePath.startsWith(suite + "/") && f(x)).length;
    bySuite[suite] = {
      instances: of(() => true),
      run: of(x => x.status === "run"),
      skipped: of(x => x.status === "skipped"),
      E: of(x => x.kind === "E"),
      C: of(x => x.kind === "C"),
    };
  }
  // The three lists in the key of the expectations file: the configured name, in code point order.
  const sorted = [...facts].sort((a: any, b: any) => G.compareStrings(a.name, b.name));
  const statusList = sorted.map((f: any) => `${f.status}\t${f.name}\n`).join("");
  const kindList = sorted
    .filter((f: any) => f.status === "run")
    .map((f: any) => `${f.kind}\t${f.name}\n`)
    .join("");
  const reasonList = sorted
    .filter((f: any) => f.status !== "run")
    .map((f: any) => `${f.name}\t${f.reason}\n`)
    .join("");
  const pathList = sorted.map((f: any) => `${f.name}\t${f.casePath}\n`).join("");
  // Against the subtests that Go printed.
  const goName = (t: string) => t.replaceAll(" ", "_");
  let differ = 0;
  const got = new Map<string, string>();
  for (const i of e.instances) got.set(goName(i.testName), i.status === "run" ? "PASS" : i.status === "skipped" ? "SKIP" : i.status);
  for (const [n, s] of got) if (goStatus.get(n) !== s) differ++;
  for (const n of goStatus.keys()) if (!got.has(n)) differ++;
  const goForm = [...got].map(([n, s]) => `${s}\t${n}`).sort((a, b) => G.compareStrings(a.slice(5), b.slice(5)));

  result[label] = {
    files: e.files,
    droppedByName: e.droppedBySkippedTests.length,
    instances: facts.length,
    uniqueNames: names.size,
    run: count(f => f.status === "run"),
    skipped: count(f => f.status === "skipped"),
    invalid: count(f => f.status === "invalid"),
    E: count(f => f.kind === "E"),
    C: count(f => f.kind === "C"),
    bySuite,
    bySource,
    accepted: count(f => f.tags.includes("accepted")),
    triaged: count(f => f.tags.includes("triaged")),
    postEmitOrder: count(f => f.tags.includes("post-emit-order")),
    reasons,
    corpus: {
      tsgoCompiler: corpus.tsgo.get("compiler").size,
      tsgoConformance: corpus.tsgo.get("conformance").size,
      ts: corpus.ts?.size,
      expectsNoErrors: corpus.expectsNoErrors.size,
      accepted: corpus.accepted.size,
      triaged: corpus.triaged.size,
      postEmitOrder: corpus.postEmitOrder.size,
    },
    differFromGoSubtests: differ,
    sha256: { status: sha(statusList), kind: sha(kindList), reason: sha(reasonList), path: sha(pathList), goSubtestsSorted: sha(goForm.join("\n") + "\n") },
    bytes: { status: statusList.length, kind: kindList.length, reason: reasonList.length, path: pathList.length },
    ms: { loadCorpus: [tLoad, cLoad], enumerate: [tEnum, cEnum], facts: [tFacts, cFacts] },
  };
  writeFileSync(`${out}/${label}.status.tsv`, statusList);
  writeFileSync(`${out}/${label}.kind.tsv`, kindList);
  writeFileSync(`${out}/${label}.reason.tsv`, reasonList);
  writeFileSync(`${out}/${label}.path.tsv`, pathList);
}
// The order of the stored list of Go.
const goSorted = [...goLines].sort((a, b) => G.compareStrings(a.slice(5), b.slice(5)));
result.go = {
  lines: goLines.length,
  storedIsSortedByName: goSorted.join("\n") === goLines.join("\n"),
  sha256Stored: sha(goLines.join("\n") + "\n"),
  sha256Sorted: sha(goSorted.join("\n") + "\n"),
};
console.log(JSON.stringify(result, null, 1));
