// The final eight options of the run instances that leave no baseline file, for a review by eye (research probe).
import { readFileSync } from "node:fs";
import { getStatus } from "./compiler_runner";
import { readFile } from "./vfs";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const rows = Bun.gunzipSync(readFileSync(new URL("../vectors/instances.tsv.gz", import.meta.url))).toString().split("\n").slice(1).filter(Boolean).map(l => l.split("\t"));
const tsgo = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
import { readdirSync } from "node:fs";
const stems = new Set<string>();
for (const s of ["compiler", "conformance"]) for (const f of readdirSync(`${tsgo}/${s}`)) { const m = /^(.*?)\.(errors\.txt|sourcemap\.txt|trace\.json|js\.map|types|symbols|js)(\.diff)?$/.exec(f); if (m) stems.add(s + "/" + m[1]); }
import { enumerateInstances } from "./compiler_runner";
const e = enumerateInstances({ casesRoot: root });
let n = 0;
for (const i of e.instances) {
  if (i.status !== "run") continue;
  if (stems.has(i.suite + "/" + i.name.replace(/\.tsx?$/, ""))) continue;
  n++;
  const st = getStatus(readFile(root + "/" + i.casePath).contents, root + "/" + i.casePath, i.config === undefined ? undefined : new Map(i.config));
  const c = i.config ?? new Map();
  const directive = ["module", "moduleresolution", "esmoduleinterop", "allowsyntheticdefaultimports", "baseurl", "outfile", "target", "alwaysstrict"].filter(k => c.has(k)).map(k => `${k}=${c.get(k)}`).join(" ");
  console.log(i.name, "| config unit:", st.hasConfigUnit, "| directives:", directive, "| final:", JSON.stringify(st.options));
}
console.log(n);
