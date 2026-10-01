// Research probe: absolute paths in the positions that name a file (import, require, reference path), per instance.
import { newCompilerTest } from "./compiler_test";
import { enumerateInstances } from "./enum_runner";
import { readFile } from "./readfile";
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const e = enumerateInstances({ casesRoot });
const cache = new Map<string, string>();
const re = /(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\(|\bpath\s*=|\bmodule)\s*(["'`])((?:\/(?!\/)|[a-zA-Z]:[\\\/])[^"'`\r\n]*)\1/g;
const cases = new Map<string, string>();
const inst = { all: 0, run: 0, lib: 0, libRun: 0, other: 0, otherRun: 0, inRootsOnly: 0 };
const otherCases = new Map<string, string>();
for (const i of e.instances) {
  const file = casesRoot + "/" + i.casePath;
  let content = cache.get(file);
  if (content === undefined) { content = readFile(file).contents; cache.set(file, content); }
  const r = newCompilerTest(content, file, i.config === undefined ? undefined : new Map(i.config));
  if (!r.ok) continue;
  const t = r.value;
  let first = "";
  let lib = false;
  let other = "";
  for (const u of [...t.toBeCompiled, ...t.otherFiles]) {
    for (const m of u.content.matchAll(re)) {
      if (first === "") first = m[2];
      if (m[2].startsWith("/.lib/")) lib = true;
      else if (other === "") other = m[0];
    }
  }
  if (first === "") continue;
  inst.all++;
  if (i.status === "run") inst.run++;
  if (lib) { inst.lib++; if (i.status === "run") inst.libRun++; }
  if (other !== "") { inst.other++; if (i.status === "run") inst.otherRun++; otherCases.set(i.casePath, other); }
  cases.set(i.casePath, first);
}
console.log(JSON.stringify(inst), "cases", cases.size, "cases with a reference that is not /.lib", otherCases.size);
for (const [k, v] of otherCases) console.log(k + "\t" + v.slice(0, 120));
