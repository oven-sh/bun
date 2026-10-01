// Prototype of the script that writes the two reference files after a sync: reference_counts.json and fixtures/instances.tsv.
// It runs under bun, reads the committed corpus through the runner and, when a clone is given, checks the lists
// against the baseline directories of typescript-go with git plumbing. No Go, no network, nothing written into a clone.
// The answers of Go are never computed here: the members "go" and "suiteRun" are copied from the file that exists,
// or from the two files that groundtruth/tables and probes/log_reasons.py print, and suiteRun is dropped when its commit is not UPSTREAM's.
// usage: bun gen_reference.ts <assembled runner set> <directory that holds corpus/ and UPSTREAM> <output directory> [<typescript-go clone>] [--go-tables <file>] [--suite-run <file>]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const k = argv.indexOf(name);
  if (k < 0) return undefined;
  const [, value] = argv.splice(k, 2);
  return value;
};
const goTablesFile = flag("--go-tables");
const suiteRunFile = flag("--suite-run");
const [asm, home, out, clone] = argv;
if (out === undefined) throw new Error("usage: bun gen_reference.ts <assembled runner set> <conformance directory> <output directory> [<typescript-go clone>] [--go-tables <file>] [--suite-run <file>]");
const runner = asm + "/test/cli/lint/conformance/runner/";
const R = await import(runner + "index.ts");
const G = await import(runner + "gostrings.ts");
const S = await import(runner + "stringutil.ts");
const B = await import(runner + "baseline.ts");
const H = await import(runner + "harnessutil.ts");
const X = await import(runner + "expectations.ts");
const R2 = await import(runner + "compiler_runner.ts");
const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

const upstream = readFileSync(home + "/UPSTREAM", "utf8");
const commitOf = (repository: string) => {
  const m = new RegExp(`^commit ${repository} ([0-9a-f]{40})$`, "m").exec(upstream);
  if (m === null) throw new Error("UPSTREAM names no commit of " + repository);
  return m[1];
};
const commits = { "typescript-go": commitOf("typescript-go"), TypeScript: commitOf("TypeScript") };

// The layout of the committed corpus, as corpus-layout-and-sync/top-down/prototype/sync.sh writes it.
const layout = {
  casesRoot: home + "/corpus/ts/tests/cases",
  libRoot: home + "/corpus/ts/tests/lib",
  tsgoBaselines: home + "/corpus/tsgo/testdata/baselines/reference/submodule",
  tsBaselines: home + "/corpus/ts/tests/baselines/reference",
  expectsNoErrors: home + "/corpus/tsgo.expects-no-errors.txt",
  accepted: home + "/corpus/tsgo/testdata/submoduleAccepted.txt",
  triaged: home + "/corpus/tsgo/testdata/submoduleTriaged.txt",
  postEmitOrder: asm + "/test/cli/lint/conformance/post-emit-order.txt",
};

const corpus = R.loadCorpus(layout);
const e = R.enumerateInstances({ casesRoot: layout.casesRoot });
interface Row {
  name: string;
  suite: string;
  casePath: string;
  status: string;
  reason: string;
  kind: string | undefined;
  source: string;
  tags: string[];
  pretty: boolean;
}
const rows: Row[] = e.instances.map((i: any) => {
  const f = R.factsOf(corpus, i);
  return {
    name: f.name,
    suite: i.suite,
    casePath: f.casePath,
    status: f.status,
    reason: f.reason,
    kind: f.kind,
    source: f.status === "run" ? B.oracleOf(corpus, i.suite, i.name).source : "",
    tags: [...f.tags],
    pretty: ((i.config?.get("pretty") ?? "") as string).toLowerCase() === "true",
  };
});
// The order of the lists of expectations.json.
rows.sort((a, b) => X.compareNames(a.name, b.name));
for (let k = 1; k < rows.length; k++) if (rows[k - 1].name === rows[k].name) throw new Error("two instances have the name " + rows[k].name);
for (const r of rows) if (/[\t\r\n]/.test(r.name + r.reason)) throw new Error("a name or a reason holds a tab or a line break: " + r.name);

// fixtures/instances.tsv: one line per instance, "<name> TAB <E|C|skipped|invalid> [TAB <reason>]".
const line = (r: Row) => (r.status === "run" ? `${r.name}\t${r.kind}\n` : `${r.name}\t${r.status}\t${r.reason}\n`);
const instances = rows.map(line).join("");

const count = (f: (r: Row) => boolean) => rows.filter(f).length;
const tally = (key: (r: Row) => string | undefined) => {
  const t: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    if (k !== undefined) t[k] = (t[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(t).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
};
const suiteCounts = (suite: string) => {
  const of = (f: (r: Row) => boolean) => count(r => r.suite === suite && f(r));
  return { instances: of(() => true), run: of(r => r.status === "run"), skipped: of(r => r.status === "skipped"), E: of(r => r.kind === "E"), C: of(r => r.kind === "C") };
};
// The subtests as Go prints them ("PASS" or "SKIP", a tab, the name with "_" for the space), in the order of the names.
const goName = (r: Row) => {
  const m = /^(.*)\(([^()]*)\)(\.tsx?)$/s.exec(r.name);
  return m === null ? r.name : `${m[1]}${m[3]}_${m[2]}`;
};
const goSubtests = rows
  .filter(r => r.status !== "invalid")
  .map(r => `${r.status === "run" ? "PASS" : "SKIP"}\t${goName(r)}`)
  .sort((a, b) => G.compareStrings(a.slice(5), b.slice(5)))
  .map(l => l + "\n")
  .join("");
const goSkipReasons = rows
  .filter(r => r.status === "skipped")
  .map(r => `${goName(r)}\t${r.reason}`)
  .sort((a, b) => G.compareStrings(a, b))
  .map(l => l + "\n")
  .join("");

// Every file of the corpus: "<id that git gives the file> <path below corpus/>", in code point order of the paths.
function corpusDigest(): { files: number; bytes: number; sha256: string } {
  const files: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(dir + "/" + entry.name, rel + entry.name + "/");
      else files.push(rel + entry.name);
    }
  };
  walk(home + "/corpus", "");
  files.sort(G.compareStrings);
  const h = createHash("sha256");
  let bytes = 0;
  for (const f of files) {
    const b = readFileSync(home + "/corpus/" + f);
    bytes += b.length;
    h.update(`${createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex")} ${f}\n`);
  }
  return { files: files.length, bytes, sha256: h.digest("hex") };
}

// Go's case and space tables over every code point, in the form of groundtruth/tables/main.go.
function tableDigests(): Record<string, string> {
  const parts: Record<string, string[]> = { lower: [], foldKey: [], space: [], white: [] };
  for (let r = 0; r <= 0x10ffff; r++) {
    const l = G.unicodeToLower(r);
    if (l !== r) parts.lower.push(`${r.toString(16)} ${l.toString(16)}\n`);
    const k = G.foldKey(r);
    if (k !== r) parts.foldKey.push(`${r.toString(16)} ${k.toString(16)}\n`);
    if (G.isSpace(r)) parts.space.push(`${r.toString(16)}\n`);
    if (S.isWhiteSpaceLike(r)) parts.white.push(`${r.toString(16)} ${S.isWhiteSpaceSingleLine(r)} ${S.isLineBreak(r)}\n`);
  }
  return Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, sha256(v.join(""))]));
}

// What Go said, from the files given or from the constants that exist. What the port computes is for the report below only.
const before = existsSync(home + "/reference_counts.json") ? JSON.parse(readFileSync(home + "/reference_counts.json", "utf8")) : {};
const goTables = goTablesFile === undefined ? undefined : JSON.parse(readFileSync(goTablesFile, "utf8"));
const go = goTables === undefined ? before.go : { unicode: goTables.unicode, tables: { lower: goTables.lower, foldKey: goTables.foldKey, space: goTables.space, white: goTables.white } };
const suiteRunGiven = suiteRunFile === undefined ? before.suiteRun : JSON.parse(readFileSync(suiteRunFile, "utf8"));
const suiteRun = suiteRunGiven !== undefined && suiteRunGiven["typescript-go"] === commits["typescript-go"] ? suiteRunGiven : undefined;
const ofThePort = { tables: tableDigests(), subtests: goSubtests.split("\n").length - 1, sha256: sha256(goSubtests), skipReasonsSha256: sha256(goSkipReasons) };

const reasons = tally(r => (r.status === "skipped" ? r.reason.replace(/^(unsupported (?:baseUrl|outFile)) .*/, "$1") : undefined));
const reference = {
  upstream: commits,
  cases: { files: e.files, droppedByName: e.droppedBySkippedTests.length, emitNotCompared: [...R2.skippedEmitTests.keys()].length },
  instances: {
    sha256: sha256(instances),
    all: rows.length,
    run: count(r => r.status === "run"),
    skipped: count(r => r.status === "skipped"),
    invalid: count(r => r.status === "invalid"),
    E: count(r => r.kind === "E"),
    C: count(r => r.kind === "C"),
    compiler: suiteCounts("compiler"),
    conformance: suiteCounts("conformance"),
    skippedBecause: reasons,
    pretty: count(r => r.kind === "E" && r.pretty),
    accepted: count(r => r.tags.includes("accepted")),
    triaged: count(r => r.tags.includes("triaged")),
    postEmitOrder: count(r => r.tags.includes("post-emit-order")),
  },
  oracle: {
    "typescript-go": count(r => r.source === "typescript-go"),
    typescript: count(r => r.source === "typescript"),
    "expects-no-errors": count(r => r.source === "expects-no-errors"),
    none: count(r => r.source === "none"),
  },
  corpus: {
    ...corpusDigest(),
    typescriptBaselines: corpus.ts?.size ?? 0,
    typescriptGoBaselines: { compiler: corpus.tsgo.get("compiler").size, conformance: corpus.tsgo.get("conformance").size },
    expectsNoErrors: corpus.expectsNoErrors.size,
    accepted: corpus.accepted.size,
    triaged: corpus.triaged.size,
  },
  options: { declared: H.optionsDeclarations.length, varying: H.getCompilerVaryByMap().size },
  go,
  suiteRun,
};
mkdirSync(out + "/fixtures", { recursive: true });
writeFileSync(out + "/reference_counts.json", JSON.stringify(reference, null, 2) + "\n");
writeFileSync(out + "/fixtures/instances.tsv", instances);
if (go === undefined) console.log("no answers of Go for the tables: run groundtruth/tables/build.sh and give its output with --go-tables");
else console.log(`tables of the port against Go's: ${JSON.stringify(ofThePort.tables) === JSON.stringify(go.tables) ? "the same" : "DIFFERENT"}`);
if (suiteRun === undefined) console.log("no run of the reference's suite at this commit: the member suiteRun is left out");
else console.log(`subtests and skip reasons of the port against the run: ${ofThePort.sha256 === suiteRun.sha256 && ofThePort.skipReasonsSha256 === suiteRun.skipReasonsSha256 && ofThePort.subtests === suiteRun.subtests ? "the same" : "DIFFERENT"}`);
console.log(`reference_counts.json ${Buffer.byteLength(JSON.stringify(reference, null, 2)) + 1} bytes, fixtures/instances.tsv ${Buffer.byteLength(instances)} bytes, ${rows.length} lines`);

// The check that needs no Go: what the baseline directories of typescript-go say about the lists.
if (clone !== undefined) {
  const stems = new Map<string, Set<string>>();
  const kinds = ["errors.txt", "sourcemap.txt", "trace.json", "js.map", "symbols", "types", "js"];
  for (const suite of ["compiler", "conformance"]) {
    const p = Bun.spawnSync(["git", "-C", clone, "-c", "core.quotePath=false", "ls-tree", "--name-only", commits["typescript-go"], `testdata/baselines/reference/submodule/${suite}/`]);
    if (p.exitCode !== 0) throw new Error(p.stderr.toString());
    for (const path of p.stdout.toString("utf8").split("\n")) {
      const file = path.slice(path.lastIndexOf("/") + 1);
      if (file === "" || file.endsWith(".diff")) continue;
      const kind = kinds.find(k => file.endsWith("." + k));
      if (kind === undefined) throw new Error("a baseline of no known kind: " + path);
      const key = suite + "/" + file.slice(0, file.length - kind.length - 1);
      if (!stems.has(key)) stems.set(key, new Set());
      stems.get(key)!.add(kind);
    }
  }
  const stemOf = (r: Row) => r.suite + "/" + r.name.replace(/\.tsx?$/, "");
  const byStem = new Map(rows.map(r => [stemOf(r), r]));
  if (byStem.size !== rows.length) throw new Error("two instances of a suite share the stem of their baselines");
  const report = {
    stemsWithABaseline: stems.size,
    ofNoInstance: [...stems.keys()].filter(k => !byStem.has(k)),
    ofAnInstanceThatIsNotRun: [...stems.keys()].filter(k => byStem.has(k) && byStem.get(k)!.status !== "run"),
    runWithoutAnyBaseline: rows.filter(r => r.status === "run" && !stems.has(stemOf(r))).length,
    skippedWithoutAnyBaseline: rows.filter(r => r.status === "skipped" && !stems.has(stemOf(r))).length,
    kindDiffers: rows.filter(r => r.status === "run" && (r.kind === "E") !== (stems.get(stemOf(r))?.has("errors.txt") ?? false)).map(r => r.name),
    errorBaselines: [...stems.values()].filter(s => s.has("errors.txt")).length,
  };
  console.log(JSON.stringify(report));
  if (report.ofNoInstance.length + report.ofAnInstanceThatIsNotRun.length + report.kindDiffers.length > 0) process.exit(1);
}
