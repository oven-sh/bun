// Name by name check of the enumeration against the baseline files that the reference committed (research probe).
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { enumerateInstances, type Instance } from "./compiler_runner";

const tsgo = "/workspace/ref/typescript-go/testdata";
const ts = "/workspace/ref/typescript-go/_submodules/TypeScript/tests";
const e = enumerateInstances({ casesRoot: ts + "/cases" });
const suffixes = [".errors.txt", ".sourcemap.txt", ".trace.json", ".contentmapper", ".js.map", ".types", ".symbols", ".js"];
function stemOf(file: string): { stem: string; suffix: string; diff: boolean } | undefined {
  let f = file;
  let diff = false;
  if (f.endsWith(".diff")) { diff = true; f = f.slice(0, -5); }
  for (const s of suffixes) if (f.endsWith(s)) return { stem: f.slice(0, f.length - s.length), suffix: s, diff };
  return undefined;
}
const stem = (i: Instance) => i.name.replace(/\.tsx?$/, "");
const bySuiteStem = new Map<string, Instance>();
let collisions = 0;
for (const i of e.instances) {
  const k = i.suite + "/" + stem(i);
  if (bySuiteStem.has(k)) { collisions++; console.log("stem collision", k, bySuiteStem.get(k)!.casePath, i.casePath); }
  bySuiteStem.set(k, i);
}
console.log("stem collisions within a suite:", collisions);
const flat = new Map<string, Instance>();
let flatCollisions = 0;
for (const i of e.instances) { if (flat.has(stem(i))) { flatCollisions++; console.log("flat stem collision", stem(i), flat.get(stem(i))!.casePath, i.casePath); } flat.set(stem(i), i); }
console.log("stem collisions across suites:", flatCollisions);

// 1. every baseline file of the reference belongs to a run instance
const seenRun = new Set<string>();
const errorStems = new Map<string, Set<string>>();
for (const suite of ["compiler", "conformance"] as const) {
  errorStems.set(suite, new Set());
  for (const root of ["submodule", "submoduleAccepted", "submoduleTriaged"]) {
    const dir = `${tsgo}/baselines/reference/${root}/${suite}`;
    if (!existsSync(dir)) continue;
    let unknown = 0, orphan = 0, onSkipped = 0, files = 0;
    for (const f of readdirSync(dir)) {
      files++;
      const p = stemOf(f);
      if (p === undefined) { unknown++; console.log("unknown suffix", root, suite, f); continue; }
      const inst = bySuiteStem.get(suite + "/" + p.stem);
      if (inst === undefined) { orphan++; if (orphan <= 20) console.log("no instance for", root, suite, f); continue; }
      if (inst.status !== "run") { onSkipped++; if (onSkipped <= 20) console.log("baseline on non-run instance", root, suite, f, inst.status, inst.reason); continue; }
      if (root === "submodule") {
        seenRun.add(suite + "/" + p.stem);
        if (p.suffix === ".errors.txt" && !p.diff) errorStems.get(suite)!.add(p.stem);
      }
    }
    console.log(`${root}/${suite}: files ${files}, unknown suffix ${unknown}, without instance ${orphan}, on a non-run instance ${onSkipped}`);
  }
}
// 2. run instances without any baseline file of the reference
const run = e.instances.filter(i => i.status === "run");
const silent = run.filter(i => !seenRun.has(i.suite + "/" + stem(i)));
console.log("run instances:", run.length, "with at least one reference baseline:", run.length - silent.length, "with none:", silent.length);
for (const i of silent.slice(0, 40)) console.log("  no baseline:", i.casePath, i.configName);
// 3. kind
for (const suite of ["compiler", "conformance"] as const) {
  const r = run.filter(i => i.suite === suite);
  const E = r.filter(i => errorStems.get(suite)!.has(stem(i))).length;
  console.log(`${suite}: E ${E}, C ${r.length - E}, error baselines in the directory ${errorStems.get(suite)!.size}`);
}
// 4. skipped instances have TypeScript's own baselines under their configured name
const tsRef = new Set(readdirSync(ts + "/baselines/reference"));
const tsStems = new Set<string>();
for (const f of tsRef) { const p = stemOf(f); if (p) tsStems.add(p.stem); }
const skipped = e.instances.filter(i => i.status === "skipped");
const skippedNoTs = skipped.filter(i => !tsStems.has(stem(i)));
console.log("skipped instances:", skipped.length, "without any TypeScript baseline of that name:", skippedNoTs.length);
for (const i of skippedNoTs.slice(0, 40)) console.log("  ", i.casePath, JSON.stringify(i.configName), i.reason);
const runNoTs = run.filter(i => !tsStems.has(stem(i)));
console.log("run instances without any TypeScript baseline of that name:", runNoTs.length);
for (const i of runNoTs.slice(0, 40)) console.log("  ", i.casePath, JSON.stringify(i.configName));
// 5. TypeScript baselines whose stem is no instance (compiler and conformance share the flat directory with other suites)
