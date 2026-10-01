// Research probe: run instances whose text names a file of the instance in another case (risk on a disk that ignores case).
import { buildHarnessFs, newCompilerTest } from "./compiler_test";
import { enumerateInstances } from "./enum_runner";
import { readFile } from "./readfile";
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const e = enumerateInstances({ casesRoot });
const cache = new Map<string, string>();
const re = /(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\(|\bpath\s*=|\btypes\s*=)\s*(["'`])([^"'`\r\n]+)\1/g;
const strip = (s: string) => s.replace(/\.(d\.)?[cm]?[jt]sx?$|\.json$/, "");
let n = 0;
const cases = new Set<string>();
const ex: string[] = [];
for (const inst of e.instances) {
  if (inst.status !== "run") continue;
  const file = casesRoot + "/" + inst.casePath;
  let content = cache.get(file);
  if (content === undefined) { content = readFile(file).contents; cache.set(file, content); }
  const r = newCompilerTest(content, file, inst.config === undefined ? undefined : new Map(inst.config));
  if (!r.ok) continue;
  const t = r.value;
  const fsx = buildHarnessFs(t, { libFiles: [], noLib: false, useCaseSensitiveFileNames: true });
  // every path segment of the instance, with and without extension
  const exact = new Set<string>();
  const lower = new Map<string, string>();
  for (const name of fsx.entries.keys()) for (const seg of name.split("/")) { if (seg === "") continue; for (const v of [seg, strip(seg)]) { exact.add(v); lower.set(v.toLowerCase(), v); } }
  let hit = "";
  for (const u of [...t.toBeCompiled, ...t.otherFiles]) {
    for (const m of u.content.matchAll(re)) {
      for (const seg of m[2].split(/[\\/]/)) {
        if (seg === "" || seg === "." || seg === "..") continue;
        for (const v of [seg, strip(seg)]) {
          if (!exact.has(v) && lower.has(v.toLowerCase())) hit = `${m[2]} against ${lower.get(v.toLowerCase())}`;
        }
      }
    }
  }
  if (hit !== "") { n++; if (!cases.has(inst.casePath)) { cases.add(inst.casePath); ex.push(inst.casePath + "\t" + hit); } }
}
console.log("run instances", n, "cases", cases.size);
for (const x of ex) console.log(x);
