// The accepted and triaged lists against the enumeration and the diff files (research probe).
import { existsSync, readFileSync } from "node:fs";
import { enumerateInstances, type Instance } from "./compiler_runner";
const tsgo = "/workspace/ref/typescript-go/testdata";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const e = enumerateInstances({ casesRoot: root });
// baseline.go:110 readFileNameSet
function readFileNameSet(path: string): Set<string> {
  const set = new Set<string>();
  for (let line of readFileSync(path, "utf8").split("\n")) {
    line = line.trim();
    if (line === "" || line[0] === "#") continue;
    set.add(line);
  }
  return set;
}
const accepted = readFileNameSet(tsgo + "/submoduleAccepted.txt");
const triaged = readFileNameSet(tsgo + "/submoduleTriaged.txt");
console.log("accepted entries", accepted.size, "triaged entries", triaged.size, "in both", [...accepted].filter(x => triaged.has(x)).length);
const kinds = (s: Set<string>) => {
  const m = new Map<string, number>();
  for (const k of s) { const x = /\.(errors\.txt|types|symbols|js|js\.map|sourcemap\.txt|trace\.json)\.diff$/.exec(k)?.[1] ?? "?"; m.set(x, (m.get(x) ?? 0) + 1); }
  return JSON.stringify([...m]);
};
console.log("accepted by baseline kind", kinds(accepted));
console.log("triaged by baseline kind", kinds(triaged));
const stem = (i: Instance) => i.name.replace(/\.tsx?$/, "");
const byKey = new Map<string, Instance>();
for (const i of e.instances) byKey.set(`${i.suite}/${stem(i)}.errors.txt.diff`, i);
for (const [label, set, dir] of [["accepted", accepted, "submoduleAccepted"], ["triaged", triaged, "submoduleTriaged"]] as const) {
  let run = 0, skipped = 0, none = 0, withFile = 0, E = 0, C = 0;
  const odd: string[] = [];
  for (const key of set) {
    if (!key.endsWith(".errors.txt.diff")) continue;
    const i = byKey.get(key);
    const file = existsSync(`${tsgo}/baselines/reference/${dir}/${key}`);
    if (file) withFile++;
    if (i === undefined) { none++; odd.push(key + "\t(no instance)\tfile=" + file); continue; }
    if (i.status === "run") {
      run++;
      const hasErr = existsSync(`${tsgo}/baselines/reference/submodule/${key.slice(0, -5)}`);
      if (hasErr) E++; else C++;
      if (!file) odd.push(key + "\trun, no diff file");
    } else { skipped++; odd.push(key + "\t" + i.status + ": " + i.reason + "\tfile=" + file); }
  }
  console.log(`${label}: error-baseline entries on run instances ${run} (E ${E}, C ${C}), on skipped ${skipped}, on no instance ${none}, diff file present ${withFile}`);
  for (const o of odd) console.log("   ", o);
}
// uncategorised diffs
import { readdirSync } from "node:fs";
let unc = 0, uncE = 0, uncC = 0;
for (const suite of ["compiler", "conformance"]) {
  for (const f of readdirSync(`${tsgo}/baselines/reference/submodule/${suite}`)) {
    if (!f.endsWith(".errors.txt.diff")) continue;
    unc++;
    if (existsSync(`${tsgo}/baselines/reference/submodule/${suite}/${f.slice(0, -5)}`)) uncE++; else uncC++;
    const key = `${suite}/${f}`;
    if (accepted.has(key) || triaged.has(key)) console.log("listed but in submodule/:", key);
  }
}
console.log(`uncategorised error diffs: ${unc} (tsgo has an error baseline: ${uncE}, tsgo has none: ${uncC})`);
