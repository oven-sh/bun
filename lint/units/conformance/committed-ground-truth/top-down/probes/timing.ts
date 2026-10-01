// Times each check that reads a committed fixture, as processor time and wall time, under the binary that runs this file.
// usage: <bun> timing.ts <assembled runner root> <conformance directory with corpus/> <fixtures directory> <steps: comma list or "all"> [small]
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const [asm, home, fx, stepsArg, smallArg] = process.argv.slice(2);
const small = smallArg === "small";
const runner = join(asm, "test/cli/lint/conformance/runner");
const R = await import(join(runner, "index.ts"));
const G = await import(join(runner, "gostrings.ts"));
const P = await import(join(runner, "test_case_parser.ts"));
const S = await import(join(runner, "scanner.ts"));
const V = await import(join(runner, "vfs.ts"));
const cmp = G.compareStrings as (a: string, b: string) => number;
const c = home + "/corpus";
const layout = {
  casesRoot: c + "/ts/tests/cases", libRoot: c + "/ts/tests/lib",
  tsgoBaselines: c + "/tsgo/testdata/baselines/reference/submodule", tsBaselines: c + "/ts/tests/baselines/reference",
  expectsNoErrors: c + "/tsgo.expects-no-errors.txt", accepted: c + "/tsgo/testdata/submoduleAccepted.txt", triaged: c + "/tsgo/testdata/submoduleTriaged.txt",
  postEmitOrder: join(asm, "test/cli/lint/conformance/post-emit-order.txt"),
};
const sha = (x: string | Uint8Array) => createHash("sha256").update(x).digest("hex");
const sampled = (path: string, n: number) => Bun.hash.crc32(path) % n === 0;
const want = new Set(stepsArg === "all" ? [] : stepsArg.split(","));
const results: string[] = [];
async function step(name: string, f: () => unknown | Promise<unknown>) {
  if (want.size > 0 && !want.has(name)) return;
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  const note = await f();
  const t1 = performance.now();
  const c1 = process.cpuUsage(c0);
  const line = `${name}\tcpu ${((c1.user + c1.system) / 1000).toFixed(0)} ms\twall ${(t1 - t0).toFixed(0)} ms\t${note ?? ""}`;
  results.push(line);
  console.log(line);
}
let corpus: any;
let cases: Map<string, string>;
await step("load", () => { corpus = R.loadCorpus(layout); cases = R.indexCases(layout.casesRoot); return `${cases.size} cases`; });
const pins = JSON.parse(readFileSync(join(fx, "reference_counts.json"), "utf8"));
await step("enumerate-all", () => {
  const e = R.enumerateInstances({ casesRoot: layout.casesRoot });
  const facts = e.instances.map((i: any) => R.factsOf(corpus, i));
  const d = (lines: string[]) => sha(lines.sort(cmp).join(""));
  const got = { names: d(facts.map((f: any) => `${f.name}\n`)), status: d(facts.map((f: any) => `${f.name}\t${f.status}\t${f.reason}\n`)), kinds: d(facts.filter((f: any) => f.status === "run").map((f: any) => `${f.name}\t${f.kind}\n`)) };
  return `${facts.length} instances, digests ${got.names === pins.digests.names && got.status === pins.digests.status && got.kinds === pins.digests.kinds ? "equal" : "DIFFER"}`;
});
await step("enumerate-sample-40", () => {
  const sample = [...cases.values()].filter(p => sampled(p, 40)).sort();
  let n = 0;
  const skips = new Map(readFileSync(join(fx, "reference_skips.tsv"), "utf8").split("\n").filter(l => l !== "").map(l => l.split("\t") as [string, string]));
  let bad = 0;
  for (const p of sample) for (const i of R.enumerateCase(layout.casesRoot, p)) { n++; if ((i.status === "skipped" ? i.reason : undefined) !== skips.get(i.name)) bad++; }
  return `${sample.length} cases, ${n} instances, ${bad} differ from the skip list`;
});
await step("skips-parse", () => {
  const skips = readFileSync(join(fx, "reference_skips.tsv"), "utf8").split("\n").filter(l => l !== "");
  return `${skips.length} rows, sha256 ${sha(readFileSync(join(fx, "reference_skips.tsv"))) === pins.skips.sha256 ? "equal" : "DIFFERS"}`;
});
await step("directives", () => {
  const inputs: any[] = JSON.parse(readFileSync(join(fx, "directives-inputs.json"), "utf8"));
  let n = 0;
  for (const i of inputs) {
    const raw = Buffer.from(i.bytes, "base64");
    let content: string;
    try { content = raw.length === 0 ? "" : G.utf8String(V.decodeBytes(raw)); } catch { continue; }
    S.skipTrivia(G.utf8ToByteString(content), 0);
    P.extractCompilerSettings(content);
    P.parseTestFilesAndSymlinksWithOptions(content, i.fileName, (name: string, content: string, fileOptions: any) => ({ value: { name, content, fileOptions }, error: undefined }), { allowImplicitFirstFile: !!i.allowImplicitFirstFile });
    n++;
  }
  JSON.parse(readFileSync(join(fx, "directives-expected.json"), "utf8"));
  return `${n} of ${inputs.length} inputs parsed`;
});
await step("corpus-digest", () => {
  const paths: string[] = [];
  const walk = (dir: string, rel: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const p = rel === "" ? entry.name : rel + "/" + entry.name; if (entry.isDirectory()) walk(dir + "/" + entry.name, p); else paths.push(p); } };
  walk(c, "");
  paths.sort(cmp);
  const h = createHash("sha256");
  let bytes = 0;
  for (const p of paths) { const b = readFileSync(c + "/" + p); bytes += b.length; h.update(`${p}\t${b.length}\t${sha(b)}\n`); }
  return `${paths.length} files, ${bytes} bytes, ${h.digest("hex") === pins.corpus.sha256 ? "equal" : "DIFFERS"}`;
});
await step("corpus-names-digest", () => {
  const paths: string[] = [];
  const walk = (dir: string, rel: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const p = rel === "" ? entry.name : rel + "/" + entry.name; if (entry.isDirectory()) walk(dir + "/" + entry.name, p); else paths.push(p); } };
  walk(c, "");
  paths.sort(cmp);
  const h = createHash("sha256");
  let bytes = 0;
  for (const p of paths) { const n = statSync(c + "/" + p).size; bytes += n; h.update(`${p}\t${n}\n`); }
  return `${paths.length} files, ${bytes} bytes by stat`;
});
const pretty = new Set(["deeplyNestedAssignabilityIssue.errors.txt", "prettyFileWithErrorsAndTabs.errors.txt"]);
await step("roundtrip-sample", () => {
  const files: { path: string; rules: any; bytes: number }[] = [];
  const add = (path: string, rules: any) => { const bytes = statSync(path).size; if (bytes <= 64 * 1024) files.push({ path, rules, bytes }); };
  for (const suite of ["compiler", "conformance"]) for (const name of corpus.tsgo.get(suite)) if (sampled(name, small ? 100 : 12) || pretty.has(name)) add(`${layout.tsgoBaselines}/${suite}/${name}`, R.tsgoRules);
  for (const name of corpus.ts) if (sampled(name, small ? 480 : 60) || pretty.has(name)) add(`${layout.tsBaselines}/${name}`, R.tscRules);
  let bad = 0; let bytes = 0;
  for (const f of files) { const r = R.roundTrip(readFileSync(f.path), f.rules); if (!r.equal) bad++; bytes += f.bytes; }
  return `${files.length} files (${files.filter(f => f.rules === R.tsgoRules).length} of typescript-go), ${bytes} bytes, ${bad} differ`;
});
await step("roundtrip-all", () => {
  let n = 0; let bad = 0; let bytes = 0;
  for (const suite of ["compiler", "conformance"]) for (const name of corpus.tsgo.get(suite)) { const b = readFileSync(`${layout.tsgoBaselines}/${suite}/${name}`); n++; bytes += b.length; if (!R.roundTrip(b, R.tsgoRules).equal) bad++; }
  for (const name of corpus.ts) { const b = readFileSync(`${layout.tsBaselines}/${name}`); n++; bytes += b.length; if (!R.roundTrip(b, R.tscRules).equal) bad++; }
  return `${n} files, ${bytes} bytes, ${bad} differ`;
});
await step("replay-sample", async () => {
  const sample = [...cases.values()].filter(p => sampled(p, small ? 1000 : 250)).sort();
  const oracle = (i: any) => R.runOracleOf(corpus, i.suite, i.name);
  const inputs: any[] = [];
  for (const p of sample) for (const i of R.enumerateCase(layout.casesRoot, p)) { if (i.status !== "run") continue; const r = R.inputOf(i, { layout }); if (r.ok) inputs.push(r.input); }
  const replayed = await R.runInstances(inputs, R.replayCheck(oracle), { oracle });
  const silent = await R.runInstances(inputs, R.emptyCheck(), { oracle });
  return `${sample.length} cases, ${inputs.length} instances, replay pass ${replayed.filter((r: any) => r.status === "pass").length}, silent pass ${silent.filter((r: any) => r.status === "pass").length} of C ${inputs.filter(i => oracle(i).kind === "C").length}`;
});
await step("replay-all", async () => {
  const oracle = (i: any) => R.runOracleOf(corpus, i.suite, i.name);
  const e = R.enumerateInstances({ casesRoot: layout.casesRoot });
  const inputs: any[] = [];
  for (const i of e.instances) { if (i.status !== "run") continue; const r = R.inputOf(i, { layout }); if (r.ok) inputs.push(r.input); }
  const replayed = await R.runInstances(inputs, R.replayCheck(oracle), { oracle });
  const by: Record<string, number> = {};
  for (const r of replayed) by[r.status] = (by[r.status] ?? 0) + 1;
  return `${inputs.length} inputs of ${e.instances.filter((i: any) => i.status === "run").length} run instances: ${JSON.stringify(by)}`;
});
