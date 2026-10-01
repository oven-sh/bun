// The check that needs no Go after a sync: the enumeration against the names of the baseline files that the two upstream projects committed.
// usage: bun witness.ts <assembled runner root> <conformance directory with corpus/> [typescript-go clone]
import { readdirSync } from "node:fs";
import { join } from "node:path";
const [asm, home, clone] = process.argv.slice(2);
const runner = join(asm, "test/cli/lint/conformance/runner");
const R = await import(join(runner, "index.ts"));
const B = await import(join(runner, "baseline.ts"));
const c = home + "/corpus";
const layout = {
  casesRoot: c + "/ts/tests/cases", libRoot: c + "/ts/tests/lib",
  tsgoBaselines: c + "/tsgo/testdata/baselines/reference/submodule", tsBaselines: c + "/ts/tests/baselines/reference",
  expectsNoErrors: c + "/tsgo.expects-no-errors.txt", accepted: c + "/tsgo/testdata/submoduleAccepted.txt", triaged: c + "/tsgo/testdata/submoduleTriaged.txt",
  postEmitOrder: home + "/post-emit-order.txt",
};
const corpus = R.loadCorpus(layout);
const e = R.enumerateInstances({ casesRoot: layout.casesRoot });
const stemOf = (name: string) => name.replace(/\.tsx?$/, "");
const bySuite = new Map<string, Map<string, any>>([["compiler", new Map()], ["conformance", new Map()]]);
const byStem = new Map<string, any[]>();
for (const i of e.instances) {
  bySuite.get(i.suite)!.set(stemOf(i.name), i);
  byStem.set(stemOf(i.name), [...(byStem.get(stemOf(i.name)) ?? []), i]);
}
console.log(`instances ${e.instances.length}; stems that two instances share: ${[...byStem.values()].filter(v => v.length > 1).length}`);

// 1. The committed corpus alone. TypeScript's error baselines: whose name is it?
const ts = { runOracle: 0, runShadowedByTsgo: 0, runExpectsNoErrors: 0, skipped: 0, orphan: 0 };
const orphans: string[] = [];
for (const file of corpus.ts) {
  const stem = file.slice(0, -".errors.txt".length);
  const list = byStem.get(stem);
  if (list === undefined) { ts.orphan++; orphans.push(file); continue; }
  const i = list[0];
  if (i.status !== "run") { ts.skipped++; continue; }
  const o = B.oracleOf(corpus, i.suite, i.name);
  if (o.source === "typescript") ts.runOracle++;
  else if (o.source === "typescript-go") ts.runShadowedByTsgo++;
  else if (o.source === "expects-no-errors") ts.runExpectsNoErrors++;
}
console.log(`TypeScript's ${corpus.ts.size} error baselines: ${JSON.stringify(ts)}`);
console.log(`  no instance has the name (first 12 of ${orphans.length}): ${orphans.slice(0, 12).join(" ")}`);
let overlayBad = 0;
for (const suite of ["compiler", "conformance"]) for (const file of corpus.tsgo.get(suite)) {
  const i = bySuite.get(suite)!.get(file.slice(0, -".errors.txt".length));
  if (i === undefined || i.status !== "run") overlayBad++;
}
console.log(`typescript-go's ${corpus.tsgo.get("compiler").size + corpus.tsgo.get("conformance").size} copied error baselines that are not the name of a run instance: ${overlayBad}`);
const skippedWithTs = e.instances.filter((i: any) => i.status === "skipped" && corpus.ts.has(B.errorBaselineName(i.name))).length;
console.log(`skipped instances ${e.instances.filter((i: any) => i.status === "skipped").length}, of which TypeScript has an error baseline of that name: ${skippedWithTs}`);

// 2. With the clone: every baseline file of typescript-go, of any kind, against the run set.
if (clone) {
  const root = clone + "/testdata/baselines/reference";
  const out = { files: 0, noInstance: 0, ofSkipped: 0 };
  const bad: string[] = [];
  const witnessed = new Set<string>();
  const kinds = new Map<string, number>();
  for (const dir of ["submodule", "submoduleAccepted", "submoduleTriaged"]) for (const suite of ["compiler", "conformance"]) {
    let files: string[] = [];
    try { files = readdirSync(`${root}/${dir}/${suite}`); } catch {}
    const stems = bySuite.get(suite)!;
    for (const f of files) {
      out.files++;
      let i: any;
      let cut = f.length;
      while ((cut = f.lastIndexOf(".", cut - 1)) > 0) if ((i = stems.get(f.slice(0, cut))) !== undefined) break;
      if (i === undefined) { out.noInstance++; bad.push(`${dir}/${suite}/${f}`); continue; }
      const kind = f.slice(cut);
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      if (i.status !== "run") { out.ofSkipped++; bad.push(`${dir}/${suite}/${f}`); continue; }
      if (dir === "submodule" && !kind.endsWith(".diff")) witnessed.add(i.name);
    }
  }
  const run = e.instances.filter((i: any) => i.status === "run");
  const silent = run.filter((i: any) => !witnessed.has(i.name));
  console.log(`typescript-go's baseline files of the two suites: ${JSON.stringify(out)}${bad.length ? " " + bad.slice(0, 10).join(" ") : ""}`);
  console.log(`  kinds: ${[...kinds].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`run instances ${run.length}: ${witnessed.size} have a baseline file of typescript-go, ${silent.length} have none`);
  const kindsOf = new Map<string, number>();
  for (const i of silent) { const k = B.oracleOf(corpus, i.suite, i.name).kind; kindsOf.set(k, (kindsOf.get(k) ?? 0) + 1); }
  console.log(`  the ${silent.length}: kinds ${JSON.stringify(Object.fromEntries(kindsOf))}: ${silent.map((i: any) => i.name).join(" ")}`);
  // The set E is the set of error baselines of typescript-go, by name.
  let eDiffer = 0;
  for (const suite of ["compiler", "conformance"]) {
    const files = new Set(readdirSync(`${root}/submodule/${suite}`).filter(f => f.endsWith(".errors.txt")));
    const ours = new Set(run.filter((i: any) => i.suite === suite && B.oracleOf(corpus, i.suite, i.name).kind === "E").map((i: any) => B.errorBaselineName(i.name)));
    for (const f of files) if (!ours.has(f)) eDiffer++;
    for (const f of ours) if (!files.has(f)) eDiffer++;
  }
  console.log(`names that are in one of the set E and the set of typescript-go's error baselines only: ${eDiffer}`);
}
