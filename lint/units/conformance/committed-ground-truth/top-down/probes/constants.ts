// Computes the pinned constants of the runner for a corpus in the committed layout, and compares them with the reference layout and with the run of the reference.
// usage: bun constants.ts <assembled runner: directory that holds test/cli/lint/conformance/runner> <conformance directory with corpus/> <out.json> [typescript-go clone] [go-subtests.tsv.gz] [ref-skips.tsv]
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const [asm, home, outPath, refClone, subtestsPath, skipsPath] = process.argv.slice(2);
const runner = join(asm, "test/cli/lint/conformance/runner");
const R = await import(join(runner, "index.ts"));
const B = await import(join(runner, "baseline.ts"));
const G = await import(join(runner, "gostrings.ts"));
const D = await import(join(runner, "diagnosticwriter.ts"));

// The committed layout: what sync.sh of corpus-layout-and-sync writes below corpus/.
export function corpusLayout(home: string) {
  const c = home + "/corpus";
  return {
    casesRoot: c + "/ts/tests/cases",
    libRoot: c + "/ts/tests/lib",
    tsgoBaselines: c + "/tsgo/testdata/baselines/reference/submodule",
    tsBaselines: c + "/ts/tests/baselines/reference",
    expectsNoErrors: c + "/tsgo.expects-no-errors.txt",
    accepted: c + "/tsgo/testdata/submoduleAccepted.txt",
    triaged: c + "/tsgo/testdata/submoduleTriaged.txt",
    postEmitOrder: join(asm, "test/cli/lint/conformance/post-emit-order.txt"),
  };
}

const sha = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
const cmp = G.compareStrings as (a: string, b: string) => number;
const digestOf = (lines: string[]) => sha(lines.slice().sort(cmp).join(""));

const t0 = performance.now();
const layout = corpusLayout(home);
const corpus = R.loadCorpus(layout);
const e = R.enumerateInstances({ casesRoot: layout.casesRoot });
const t1 = performance.now();
const facts = e.instances.map((i: any) => R.factsOf(corpus, i));
const t2 = performance.now();

const count = (f: (x: any) => boolean) => facts.filter(f).length;
const reasons: Record<string, number> = {};
const shortReason = (r: string) => r.replace(/^(unsupported (?:baseUrl|outFile)) .*/s, "$1");
for (const f of facts) if (f.status === "skipped") reasons[shortReason(f.reason)] = (reasons[shortReason(f.reason)] ?? 0) + 1;
const sortedReasons = Object.fromEntries(Object.entries(reasons).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])));

// Oracle of every run instance through the committed layout.
const sources: Record<string, number> = {};
const oracleLines: string[] = [];
let pretty = 0;
let oracleBytes = 0;
const bySource = new Map<string, string>();
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const o = B.oracleOf(corpus, i.suite, i.name);
  sources[o.source] = (sources[o.source] ?? 0) + 1;
  bySource.set(i.name, o.source);
  if (o.kind === "E") {
    const bytes = B.readOracle(o)!;
    oracleBytes += bytes.length;
    oracleLines.push(`${i.name}\t${sha(bytes)}\n`);
    if (Buffer.from(bytes).includes("\x1b[")) pretty++;
  }
}
const t3 = performance.now();

const goName = (testName: string) => testName.replaceAll(" ", "_");
const subtestLines = e.instances.map((i: any) => `${i.status === "run" ? "PASS" : i.status === "skipped" ? "SKIP" : i.status}\t${goName(i.testName)}\n`);
const nameLines = facts.map((f: any) => `${f.name}\n`);
const statusLines = facts.map((f: any) => `${f.name}\t${f.status}\t${f.reason}\n`);
const kindLines = facts.filter((f: any) => f.status === "run").map((f: any) => `${f.name}\t${f.kind}\n`);
const tagLines = e.instances.map((i: any, k: number) => [i.name, [...i.tags, ...facts[k].tags].sort(cmp).join(",")]).filter(([, t]: any) => t !== "").map(([n, t]: any) => `${n}\t${t}\n`);
const tagCount: Record<string, number> = {};
e.instances.forEach((i: any, k: number) => { for (const t of [...i.tags, ...facts[k].tags]) tagCount[t] = (tagCount[t] ?? 0) + 1; });

// One row per directory of cases: counts and the start of the digest of its rows.
const dirs = new Map<string, { files: Set<string>; rows: string[]; instances: number; run: number; skipped: number; E: number; C: number }>();
for (const f of facts) {
  let d = dirs.get(f.directory);
  if (d === undefined) dirs.set(f.directory, (d = { files: new Set(), rows: [], instances: 0, run: 0, skipped: 0, E: 0, C: 0 }));
  d.files.add(f.casePath);
  d.instances++;
  if (f.status === "run") d.run++;
  if (f.status === "skipped") d.skipped++;
  if (f.kind === "E") d.E++;
  if (f.kind === "C") d.C++;
  d.rows.push(`${f.name}\t${f.status}\t${f.reason}\t${f.kind ?? ""}\n`);
}
const directories = [...dirs].sort((a, b) => cmp(a[0], b[0])).map(([name, d]) => [name, d.files.size, d.instances, d.run, d.skipped, d.E, d.C, digestOf(d.rows).slice(0, 12)]);

// The files of the corpus: path, size and digest of each, in byte order of the paths.
function walk(dir: string, rel: string, out: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = rel === "" ? entry.name : rel + "/" + entry.name;
    if (entry.isDirectory()) walk(dir + "/" + entry.name, p, out);
    else out.push(p);
  }
}
const paths: string[] = [];
walk(home + "/corpus", "", paths);
paths.sort(cmp);
let corpusBytes = 0;
const listing = createHash("sha256");
const parts: Record<string, { files: number; bytes: number }> = {};
for (const p of paths) {
  const bytes = readFileSync(home + "/corpus/" + p);
  corpusBytes += bytes.length;
  listing.update(`${p}\t${bytes.length}\t${sha(bytes)}\n`);
  const part = p.startsWith("ts/tests/cases/compiler/") ? "ts/tests/cases/compiler" : p.startsWith("ts/tests/cases/conformance/") ? "ts/tests/cases/conformance" : p.startsWith("ts/tests/baselines/reference/") ? "ts/tests/baselines/reference" : p.startsWith("ts/tests/lib/") ? "ts/tests/lib" : p.startsWith("tsgo/testdata/baselines/reference/submodule/compiler/") ? "tsgo/testdata/baselines/reference/submodule/compiler" : p.startsWith("tsgo/testdata/baselines/reference/submodule/conformance/") ? "tsgo/testdata/baselines/reference/submodule/conformance" : "other";
  parts[part] ??= { files: 0, bytes: 0 };
  parts[part].files++;
  parts[part].bytes += bytes.length;
}
const t4 = performance.now();

const upstream = Object.fromEntries(readFileSync(home + "/UPSTREAM", "utf8").split("\n").map(l => l.split(" ")).filter(w => w[0] === "commit").map(w => [w[1], w[2]]));
const result = {
  upstream,
  corpus: { files: paths.length, bytes: corpusBytes, sha256: listing.digest("hex"), parts,
    tsBaselines: corpus.ts?.size, tsgoBaselines: { compiler: corpus.tsgo.get("compiler").size, conformance: corpus.tsgo.get("conformance").size },
    expectsNoErrors: corpus.expectsNoErrors.size, accepted: corpus.accepted.size, triaged: corpus.triaged.size, postEmitOrder: corpus.postEmitOrder.size },
  enumeration: {
    files: e.files, droppedByName: e.droppedBySkippedTests.length, instances: facts.length,
    run: count(f => f.status === "run"), skipped: count(f => f.status === "skipped"), invalid: count(f => f.status === "invalid"),
    E: count(f => f.kind === "E"), C: count(f => f.kind === "C"),
    compiler: { instances: count(f => f.casePath.startsWith("compiler/")), run: count(f => f.status === "run" && f.casePath.startsWith("compiler/")), E: count(f => f.kind === "E" && f.casePath.startsWith("compiler/")), C: count(f => f.kind === "C" && f.casePath.startsWith("compiler/")) },
    conformance: { instances: count(f => f.casePath.startsWith("conformance/")), run: count(f => f.status === "run" && f.casePath.startsWith("conformance/")), E: count(f => f.kind === "E" && f.casePath.startsWith("conformance/")), C: count(f => f.kind === "C" && f.casePath.startsWith("conformance/")) },
    skippedByReason: sortedReasons, tags: tagCount, oracleSource: sources, prettyOracles: pretty, oracleBytes,
  },
  digests: { subtests: digestOf(subtestLines), names: digestOf(nameLines), status: digestOf(statusLines), kinds: digestOf(kindLines), tags: digestOf(tagLines), oracles: digestOf(oracleLines) },
  directories,
};
writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ ...result, directories: directories.length + " rows" }, null, 1));
console.log(`ms: enumerate ${(t1 - t0).toFixed(0)}, facts ${(t2 - t1).toFixed(0)}, oracles ${(t3 - t2).toFixed(0)}, corpus listing ${(t4 - t3).toFixed(0)}`);

// Against the run of the reference: the names with PASS or SKIP, and the reason of every skip.
if (subtestsPath) {
  const ref = gunzipSync(readFileSync(subtestsPath)).toString("utf8").split("\n").filter(l => l !== "").map(l => l + "\n");
  console.log(`reference subtests ${ref.length}, digest ${digestOf(ref)}: ${digestOf(ref) === result.digests.subtests ? "equal to the enumeration" : "DIFFERS"}`);
}
if (skipsPath) {
  const ref = readFileSync(skipsPath, "utf8").split("\n").filter(l => l !== "").map(l => l + "\n");
  const ours = e.instances.filter((i: any) => i.status === "skipped").map((i: any) => `${goName(i.testName)}\t${i.reason}\n`);
  console.log(`reference skips ${ref.length}, digest ${digestOf(ref)}: ${digestOf(ref) === digestOf(ours) ? "every skip has the reason text of the reference" : "DIFFERS"}`);
  if (digestOf(ref) !== digestOf(ours)) {
    const set = new Set(ref);
    console.log(ours.filter(l => !set.has(l)).slice(0, 10));
  }
}
// Against the reference layout: the same kind and the same oracle bytes for every run instance.
if (refClone) {
  const rl = R.referenceLayout(refClone);
  const rc = R.loadCorpus(rl);
  let differ = 0;
  const refSources: Record<string, number> = {};
  for (const i of e.instances) {
    if (i.status !== "run") continue;
    const a = B.oracleOf(corpus, i.suite, i.name);
    const b = B.oracleOf(rc, i.suite, i.name);
    refSources[b.source] = (refSources[b.source] ?? 0) + 1;
    if (a.kind !== b.kind) { differ++; if (differ < 5) console.log("kind differs", i.name, a, b); continue; }
    if (a.kind === "E" && !Buffer.from(B.readOracle(a)!).equals(Buffer.from(B.readOracle(b)!))) { differ++; if (differ < 5) console.log("bytes differ", i.name); }
  }
  console.log(`reference layout: sources ${JSON.stringify(refSources)}; instances whose oracle differs between the layouts: ${differ}`);
}
