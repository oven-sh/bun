import { buildHarnessFs, newCompilerTest } from "./compiler_test";
import { enumerateInstances } from "./enum_runner";
import { MemFs } from "./memfs";
import { readFile } from "./readfile";
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const e = enumerateInstances({ casesRoot });
const cache = new Map<string, string>();
const c: Record<string, number> = {};
const bump = (k: string) => (c[k] = (c[k] ?? 0) + 1);
const seenCase = new Set<string>();
for (const inst of e.instances) {
  const file = casesRoot + "/" + inst.casePath;
  let content = cache.get(file);
  if (content === undefined) { content = readFile(file).contents; cache.set(file, content); }
  const r = newCompilerTest(content, file, inst.config === undefined ? undefined : new Map(inst.config));
  if (!r.ok) continue;
  const t = r.value;
  if (t.symlinks.size === 0) continue;
  if (seenCase.has(inst.casePath)) continue;
  seenCase.add(inst.casePath);
  const fsx = buildHarnessFs(t, { libFiles: [], noLib: false, useCaseSensitiveFileNames: true });
  const model = new MemFs(fsx.entries, true);
  bump("cases with links");
  const via = content.includes("@link") ? (/@symlink/i.test(content) ? "both directives" : "@link") : "@symlink";
  bump("directive: " + via);
  for (const [name, entry] of fsx.entries) {
    if (entry.kind !== "symlink") continue;
    bump("links");
    const st = model.stat(entry.target);
    bump("target is " + (st === undefined ? "absent" : st.kind));
    const key = name.slice(1);
    const real = model.m.get(key)?.realpath;
    if (real !== key) bump("link whose own path lies below another link");
    if ([...fsx.entries.keys()].some(n => n !== name && n.startsWith(name + "/"))) bump("a unit is named below the link");
    if ([...t.toBeCompiled, ...t.otherFiles].some(u => u.unitName === name)) bump("link with the name of a unit");
    if (entry.target.startsWith(name + "/") || name.startsWith(entry.target + "/")) bump("link and target nest");
  }
}
console.log(JSON.stringify(c, null, 1));
