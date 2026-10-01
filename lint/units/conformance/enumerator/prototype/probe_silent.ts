// Why a run instance has no baseline file at all in the reference (research probe).
import { readdirSync, existsSync } from "node:fs";
import { enumerateInstances, type Instance } from "./compiler_runner";
const tsgo = "/workspace/ref/typescript-go/testdata";
const ts = "/workspace/ref/typescript-go/_submodules/TypeScript/tests";
const e = enumerateInstances({ casesRoot: ts + "/cases" });
const stem = (i: Instance) => i.name.replace(/\.tsx?$/, "");
const have = new Map<string, Set<string>>();
for (const suite of ["compiler", "conformance"]) {
  for (const f of readdirSync(`${tsgo}/baselines/reference/submodule/${suite}`)) {
    const m = /^(.*?)\.(errors\.txt|sourcemap\.txt|trace\.json|contentmapper|js\.map|types|symbols|js)(\.diff)?$/.exec(f);
    if (!m) continue;
    const k = suite + "/" + m[1];
    if (!have.has(k)) have.set(k, new Set());
    have.get(k)!.add(m[2] + (m[3] ?? ""));
  }
}
let n = 0;
const combos = new Map<string, number>();
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const h = have.get(i.suite + "/" + stem(i));
  const c = i.config ?? new Map();
  const key = [...(h ?? [])].filter(x => !x.endsWith(".diff")).sort().join(",") || "(none)";
  combos.set(key, (combos.get(key) ?? 0) + 1);
  if (h === undefined || [...h].every(x => x.endsWith(".diff"))) {
    n++;
    console.log(i.casePath, JSON.stringify(i.configName), "noTypesAndSymbols=" + c.get("notypesandsymbols"), "noEmit=" + c.get("noemit"), "emitDeclarationOnly=" + c.get("emitdeclarationonly"));
  }
}
console.log("silent:", n);
for (const [k, v] of [...combos].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(6), k);
