// Prototype of the script that pins the constants of the runner after sync.sh: it writes reference_counts.json and the list of instances for the corpus in the committed layout.
// usage: bun pin.ts <assembled runner root> <conformance directory with UPSTREAM, post-emit-order.txt and corpus/> <out directory> [--compact] [--reference <typescript-go clone>] [--reference-log <output of go test -v of TestSubmodule>]
// Default: reference_instances.tsv, every instance by name. --compact: reference_skips.tsv and 256 bucket digests in its place. No Go and no network.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const [asm, home, out] = argv;
const compact = argv.includes("--compact");
const clone = flag("--reference");
const log = flag("--reference-log");
const runner = join(asm, "test/cli/lint/conformance/runner");
const R = await import(join(runner, "index.ts"));
const B = await import(join(runner, "baseline.ts"));
const G = await import(join(runner, "gostrings.ts"));
const cmp = G.compareStrings as (a: string, b: string) => number;
const sha = (x: string | Uint8Array) => createHash("sha256").update(x).digest("hex");
// The digest of a set of rows: sha256 of the rows in the byte order of their UTF-8 text, each row with its line feed.
const digestOf = (rows: string[]) => sha(rows.slice().sort(cmp).join(""));
// The bucket of a case. A debug build enumerates the first eight buckets, about 48 cases each; a release build all of them.
const buckets = 256;
const bucketOf = (casePath: string) => Bun.hash.crc32(casePath) % buckets;

const c = home + "/corpus";
const layout = {
  casesRoot: c + "/ts/tests/cases",
  libRoot: c + "/ts/tests/lib",
  tsgoBaselines: c + "/tsgo/testdata/baselines/reference/submodule",
  tsBaselines: c + "/ts/tests/baselines/reference",
  expectsNoErrors: c + "/tsgo.expects-no-errors.txt",
  accepted: c + "/tsgo/testdata/submoduleAccepted.txt",
  triaged: c + "/tsgo/testdata/submoduleTriaged.txt",
  postEmitOrder: home + "/post-emit-order.txt",
};
const corpus = R.loadCorpus(layout);
const e = R.enumerateInstances({ casesRoot: layout.casesRoot });
const facts: any[] = e.instances.map((i: any) => R.factsOf(corpus, i));
const n = (f: (x: any) => boolean) => facts.filter(f).length;
const inSuite = (s: string) => (f: any) => f.casePath.startsWith(s + "/");
const suite = (s: string) => ({
  instances: n(inSuite(s)),
  run: n(f => inSuite(s)(f) && f.status === "run"),
  skipped: n(f => inSuite(s)(f) && f.status === "skipped"),
  E: n(f => inSuite(s)(f) && f.kind === "E"),
  C: n(f => inSuite(s)(f) && f.kind === "C"),
});
const byCount = (m: Map<string, number>) => Object.fromEntries([...m].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])));
const tally = (keys: Iterable<string>) => {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
};

// The text of a skip without the path that two of the reasons end with.
const shortReason = (r: string) => r.replace(/^(unsupported (?:baseUrl|outFile)) .*/s, "$1");
const goName = (testName: string) => testName.replaceAll(" ", "_");
const subtestRows = e.instances.map((i: any) => `${i.status === "run" ? "PASS" : i.status === "skipped" ? "SKIP" : i.status}\t${goName(i.testName)}\n`);
const skipRowsOfGo = e.instances.filter((i: any) => i.status === "skipped").map((i: any) => `${goName(i.testName)}\t${i.reason}\n`);

// The oracle of every run instance, through the four steps of oracleOf.
const sources: string[] = [];
const oracleRows: string[] = [];
let pretty = 0;
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const o = B.oracleOf(corpus, i.suite, i.name);
  sources.push(o.source);
  if (o.kind !== "E") continue;
  const bytes = Buffer.from(B.readOracle(o)!);
  oracleRows.push(`${i.name}\t${sha(bytes)}\n`);
  if (bytes.includes("\x1b[")) pretty++;
}

// What each error baseline of TypeScript in the corpus is, by the instance that has its name.
const byStem = new Map<string, any>(e.instances.map((i: any) => [B.errorBaselineName(i.name), i]));
const tsUse: string[] = [];
for (const file of corpus.ts) {
  const i = byStem.get(file);
  if (i === undefined) tsUse.push("noInstance");
  else if (i.status !== "run") tsUse.push("ofSkippedInstance");
  else tsUse.push({ "typescript": "oracle", "typescript-go": "behindTypescriptGo", "expects-no-errors": "behindExpectsNoErrors" }[B.oracleOf(corpus, i.suite, i.name).source as string] ?? "other");
}

// The files of the corpus in the byte order of their paths: path, size and sha256 of each. Own files that start with a dot directly in corpus/ are no part of it.
const paths: string[] = [];
const walk = (dir: string, rel: string) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (rel === "" && entry.name.startsWith(".")) continue;
    const p = rel === "" ? entry.name : rel + "/" + entry.name;
    if (entry.isDirectory()) walk(dir + "/" + entry.name, p);
    else paths.push(p);
  }
};
walk(c, "");
paths.sort(cmp);
const listing = createHash("sha256");
let corpusBytes = 0;
for (const p of paths) {
  const bytes = readFileSync(c + "/" + p);
  corpusBytes += bytes.length;
  listing.update(`${p}\t${bytes.length}\t${sha(bytes)}\n`);
}

const row = (f: any) => `${f.name}\t${f.status}\t${f.reason}\t${f.kind ?? ""}\n`;
const bucketRows: (number | string)[][] = [];
for (let k = 0; k < buckets; k++) {
  const part = facts.filter(f => bucketOf(f.casePath) === k);
  bucketRows.push([k, new Set(part.map(f => f.casePath)).size, part.length, part.filter(f => f.status === "run").length, part.filter(f => f.status === "skipped").length, part.filter(f => f.kind === "E").length, part.filter(f => f.kind === "C").length, digestOf(part.map(row)).slice(0, 16)]);
}

const skipsText = facts.filter(f => f.status === "skipped").map(f => `${f.name}\t${f.reason}\n`).sort(cmp).join("");
// The other form of the list: every instance, name TAB status TAB reason TAB kind. With it the skip list and the buckets are not needed.
const instancesText = facts.map(row).sort(cmp).join("");
const upstream = Object.fromEntries(readFileSync(home + "/UPSTREAM", "utf8").split("\n").map(l => l.trim().split(" ")).filter(w => w[0] === "commit").map(w => [w[1], w[2]]));

const pins: any = {
  upstream,
  corpus: {
    files: paths.length,
    bytes: corpusBytes,
    sha256: listing.digest("hex"),
    cases: R.indexCases(layout.casesRoot).size,
    tsBaselines: corpus.ts.size,
    tsgoBaselines: { compiler: corpus.tsgo.get("compiler").size, conformance: corpus.tsgo.get("conformance").size },
    expectsNoErrors: corpus.expectsNoErrors.size,
    accepted: corpus.accepted.size,
    triaged: corpus.triaged.size,
    postEmitOrder: corpus.postEmitOrder.size,
  },
  enumeration: {
    files: e.files,
    droppedByName: e.droppedBySkippedTests.length,
    instances: facts.length,
    run: n(f => f.status === "run"),
    skipped: n(f => f.status === "skipped"),
    invalid: n(f => f.status === "invalid"),
    E: n(f => f.kind === "E"),
    C: n(f => f.kind === "C"),
    compiler: suite("compiler"),
    conformance: suite("conformance"),
    skippedByReason: byCount(tally(facts.filter(f => f.status === "skipped").map(f => shortReason(f.reason)))),
    tags: byCount(tally(e.instances.flatMap((i: any, k: number) => [...i.tags, ...facts[k].tags]))),
    oracleSource: byCount(tally(sources)),
    prettyOracles: pretty,
    tsBaselineUse: byCount(tally(tsUse)),
  },
  digests: {
    subtests: digestOf(subtestRows),
    names: digestOf(facts.map(f => `${f.name}\n`)),
    status: digestOf(facts.map(f => `${f.name}\t${f.status}\t${f.reason}\n`)),
    kinds: digestOf(facts.filter(f => f.status === "run").map(f => `${f.name}\t${f.kind}\n`)),
    oracles: digestOf(oracleRows),
  },
};
if (compact) {
  pins.skips = { rows: n(f => f.status === "skipped"), sha256: sha(skipsText) };
  pins.buckets = { of: buckets, columns: ["bucket", "cases", "instances", "run", "skipped", "E", "C", "digest"], rows: bucketRows };
} else {
  pins.list = { rows: facts.length, sha256: sha(instancesText) };
}

// The baseline files of typescript-go in the clone, of every kind: each is the name of a run instance, and nearly every run instance has one.
if (clone !== undefined) {
  const stems = new Map<string, Map<string, any>>([["compiler", new Map()], ["conformance", new Map()]]);
  for (const i of e.instances) stems.get(i.suite)!.set(i.name.replace(/\.tsx?$/, ""), i);
  const root = clone + "/testdata/baselines/reference";
  let files = 0;
  const bad: string[] = [];
  const witnessed = new Set<string>();
  for (const dir of ["submodule", "submoduleAccepted", "submoduleTriaged"]) {
    for (const s of ["compiler", "conformance"]) {
      let names: string[] = [];
      try {
        names = readdirSync(`${root}/${dir}/${s}`);
      } catch {}
      for (const f of names) {
        files++;
        let i: any;
        let cut = f.length;
        while ((cut = f.lastIndexOf(".", cut - 1)) > 0) if ((i = stems.get(s)!.get(f.slice(0, cut))) !== undefined) break;
        if (i === undefined || i.status !== "run") bad.push(`${dir}/${s}/${f}`);
        else if (dir === "submodule" && !f.endsWith(".diff")) witnessed.add(i.name);
      }
    }
  }
  const silent = e.instances.filter((i: any) => i.status === "run" && !witnessed.has(i.name)).map((i: any) => i.name);
  pins.referenceBaselines = { files, notOfARunInstance: bad.length, runInstancesWithOne: witnessed.size, runInstancesWithNone: silent.length };
  if (bad.length > 0) console.error(`baseline files of typescript-go that are not the name of a run instance:\n  ${bad.slice(0, 40).join("\n  ")}`);
  console.error(`run instances without a baseline file of typescript-go (${silent.length}): ${silent.join(" ")}`);
}

// The run of the reference itself: the lines "--- PASS" and "--- SKIP" of the subtests of TestSubmodule and the text of every skip.
if (log !== undefined) {
  const subtests: string[] = [];
  const skips: string[] = [];
  let name = "?";
  for (const line of readFileSync(log, "utf8").split("\n")) {
    let m: RegExpExecArray | null;
    if ((m = /^=== (?:NAME|CONT|RUN) +TestSubmodule\/(.*)$/.exec(line))) name = m[1];
    else if (line.startsWith("=== ")) name = "?";
    else if ((m = /^    compiler_runner\.go:\d+: (.*)$/.exec(line)) && !name.includes("/")) skips.push(`${name}\t${m[1]}\n`);
    else if ((m = /^    --- (PASS|SKIP): TestSubmodule\/(.*) \([0-9.]+s\)$/.exec(line))) subtests.push(`${m[1]}\t${m[2]}\n`);
  }
  const run = { "typescript-go": upstream["typescript-go"], subtests: digestOf(subtests), skips: digestOf(skips) };
  const ours = { subtests: pins.digests.subtests, skips: digestOf(skipRowsOfGo) };
  if (run.subtests !== ours.subtests || run.skips !== ours.skips) {
    const a = new Set(subtests.concat(skips));
    const b = new Set(subtestRows.concat(skipRowsOfGo));
    console.error(`the enumeration is not the run of the reference (${subtests.length} subtests, ${skips.length} skips in the log):`);
    for (const x of a) if (!b.has(x)) console.error("  only the reference: " + x.trimEnd());
    for (const x of b) if (!a.has(x)) console.error("  only the enumeration: " + x.trimEnd());
    process.exit(1);
  }
  pins.referenceRun = run;
}

// One form: two spaces, one row of the buckets per line, a line feed at the end.
function formatPins(p: any): string {
  if (p.buckets === undefined) return JSON.stringify(p, null, 2) + "\n";
  const marker = "@@rows@@";
  const text = JSON.stringify({ ...p, buckets: { ...p.buckets, columns: "@@columns@@", rows: marker } }, null, 2);
  const rows = "[\n" + p.buckets.rows.map((r: unknown[]) => "      " + JSON.stringify(r).replaceAll(",", ", ")).join(",\n") + "\n    ]";
  return text.replace(JSON.stringify(marker), rows).replace('"@@columns@@"', JSON.stringify(p.buckets.columns).replaceAll(",", ", ")) + "\n";
}
mkdirSync(out, { recursive: true });
const listName = compact ? "reference_skips.tsv" : "reference_instances.tsv";
const listText = compact ? skipsText : instancesText;
writeFileSync(join(out, "reference_counts.json"), formatPins(pins));
writeFileSync(join(out, listName), listText);
console.log(`wrote ${join(out, "reference_counts.json")} (${formatPins(pins).length} bytes) and ${join(out, listName)} (${listText.length} bytes)`);
