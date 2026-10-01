// The oracle of each run instance: typescript-go's error baseline, TypeScript's, both or neither (research probe).
import { existsSync, readFileSync } from "node:fs";
import { enumerateInstances, type Instance } from "./compiler_runner";
const tsgo = "/workspace/ref/typescript-go/testdata/baselines/reference";
const ts = "/workspace/ref/typescript-go/_submodules/TypeScript/tests";
const e = enumerateInstances({ casesRoot: ts + "/cases" });
const stem = (i: Instance) => i.name.replace(/\.tsx?$/, "");
const c = { both_same: 0, both_differ: 0, tsgo_only: 0, ts_only: 0, neither: 0 };
const tsOnly: string[] = [];
const per: Record<string, typeof c> = { compiler: { ...c }, conformance: { ...c } };
let diffFiles = 0, differNoDiffFile = 0, sameButDiffFile = 0;
const fixup = (old: string) => old.split("\n").map(l => (l.startsWith("==== ./") ? "==== " + l.slice(7) : l)).join("\n");
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const a = `${tsgo}/submodule/${i.suite}/${stem(i)}.errors.txt`;
  const b = `${ts}/baselines/reference/${stem(i)}.errors.txt`;
  const ha = existsSync(a), hb = existsSync(b);
  const hasDiff = ["submodule", "submoduleAccepted", "submoduleTriaged"].some(r => existsSync(`${tsgo}/${r}/${i.suite}/${stem(i)}.errors.txt.diff`));
  if (hasDiff) diffFiles++;
  let k: keyof typeof c;
  if (ha && hb) {
    const same = readFileSync(a, "latin1") === fixup(readFileSync(b, "latin1"));
    const raw = readFileSync(a, "latin1") === readFileSync(b, "latin1");
    k = raw ? "both_same" : "both_differ";
    if (!raw && !hasDiff) differNoDiffFile++;
    if (raw && hasDiff) sameButDiffFile++;
  } else if (ha) k = "tsgo_only";
  else if (hb) { k = "ts_only"; tsOnly.push(`${i.suite}/${stem(i)}`); }
  else k = "neither";
  c[k]++;
  per[i.suite][k]++;
}
console.log(JSON.stringify(c));
console.log(JSON.stringify(per));
console.log("instances with an error diff file:", diffFiles, "bytes differ but no diff file:", differNoDiffFile, "bytes equal but diff file:", sameButDiffFile);
console.log("TypeScript has an error baseline, typescript-go has none:", tsOnly.length);
for (const x of tsOnly) console.log("  ", x);
