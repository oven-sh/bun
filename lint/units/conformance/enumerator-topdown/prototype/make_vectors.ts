// Research probe: enumerates the pinned corpus, adds kind and tags from the reference's committed baselines, checks the result.
// usage: bun make_vectors.ts <typescript-go checkout> <output .tsv>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { enumerateSuite, skippedEmitTests, type Instance } from "./compiler_runner";

const ref = process.argv[2] ?? "/workspace/ref/typescript-go";
const out = process.argv[3] ?? "instances.tsv";
const casesRoot = `${ref}/_submodules/TypeScript/tests/cases`;
const tsgo = `${ref}/testdata/baselines/reference`;
const readList = (p: string) => new Set(readFileSync(p, "utf8").split("\n").map(l => l.trim()).filter(l => l !== "" && l[0] !== "#"));
const accepted = readList(`${ref}/testdata/submoduleAccepted.txt`);
const triaged = readList(`${ref}/testdata/submoduleTriaged.txt`);
const emit = new Set(skippedEmitTests);
const suffixes = [".sourcemap.txt", ".errors.txt", ".trace.json", ".symbols", ".js.map", ".types", ".js"];

const rows: string[] = ["name\tsuite\tcasePath\tconfigurationName\tstatus\treason\tkind\ttags\tconfiguration"];
const totals: Record<string, number> = {};
const bump = (k: string) => (totals[k] = (totals[k] ?? 0) + 1);
const problems: string[] = [];
for (const suite of ["compiler", "conformance"] as const) {
  const r = enumerateSuite(casesRoot, suite);
  const files = readdirSync(`${tsgo}/submodule/${suite}`);
  const have = new Set(files);
  const stems = new Set<string>();
  for (const f of files) {
    const base = f.endsWith(".diff") ? f.slice(0, -5) : f;
    const suf = suffixes.find(s => base.endsWith(s));
    if (suf === undefined) problems.push(`unknown baseline suffix: ${suite}/${f}`);
    else stems.add(base.slice(0, -suf.length));
  }
  const runStems = new Set<string>();
  bump(`${suite} files`);
  totals[`${suite} files`] = r.files;
  totals[`${suite} dropped`] = r.dropped.length;
  for (const i of r.instances) {
    const stem = i.name.replace(/\.tsx?$/, "");
    const tags: string[] = [];
    let kind = "";
    if (i.status === "run") {
      runStems.add(stem);
      kind = have.has(stem + ".errors.txt") ? "E" : "C";
      const baselined = stems.has(stem);
      const silent = String(i.configuration.notypesandsymbols).toLowerCase() === "true" && String(i.configuration.noemit).toLowerCase() === "true";
      if (!baselined && !(silent && kind === "C")) problems.push(`run instance without a baseline: ${suite}/${i.name}`);
      if (!baselined) bump(`${suite} run without any baseline file`);
    } else if (stems.has(stem)) {
      problems.push(`${i.status} instance with a baseline: ${suite}/${i.name}`);
    }
    const key = `${suite}/${stem}.errors.txt.diff`;
    if (accepted.has(key)) tags.push("accepted");
    if (triaged.has(key)) tags.push("triaged");
    if (emit.has(i.casePath.split("/").pop()!)) tags.push("skipped-emit");
    if ((accepted.has(key) || triaged.has(key)) && i.status !== "run") problems.push(`listed and not run: ${key}`);
    bump(`${suite} instances`);
    bump(`${suite} ${i.status}`);
    if (kind !== "") bump(`${suite} ${kind}`);
    for (const t of tags) bump(`tag ${t}${i.status === "run" ? "" : " (" + i.status + ")"}`);
    rows.push([i.name, suite, i.casePath, i.configurationName, i.status, i.reason, kind, tags.join(","), JSON.stringify(i.configuration)].join("\t"));
  }
  for (const s of stems) if (!runStems.has(s)) problems.push(`baseline without a run instance: ${suite}/${s}`);
}
writeFileSync(out, rows.join("\n") + "\n");
for (const k of Object.keys(totals).sort()) console.log(String(totals[k]).padStart(7), k);
console.log("rows", rows.length - 1, "problems", problems.length);
for (const p of problems) console.log("  " + p);
