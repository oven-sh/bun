// Research probe: panics of the compile-time file system, config units by status, normal forms of names, root rules by status.
import { buildHarnessFs, newCompilerTest } from "./compiler_test";
import { enumerateInstances } from "./enum_runner";
import { MemFs, MemFsPanic, type MemInput } from "./memfs";
import { readFile } from "./readfile";
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const e = enumerateInstances({ casesRoot });
const cache = new Map<string, string>();
const c: Record<string, number> = {};
const bump = (k: string) => (c[k] = (c[k] ?? 0) + 1);
const notes: string[] = [];
const cfgCases = new Map<string, Set<string>>();
for (const inst of e.instances) {
  const file = casesRoot + "/" + inst.casePath;
  let content = cache.get(file);
  if (content === undefined) { content = readFile(file).contents; cache.set(file, content); }
  const config = inst.config === undefined ? undefined : new Map(inst.config);
  const r = newCompilerTest(content, file, config);
  if (!r.ok) { bump(`${inst.status}: roots ${r.status}`); continue; }
  const t = r.value;
  bump(`${inst.status}: rule ${t.rule}`);
  if (t.rule === "config") {
    if (!cfgCases.has(inst.casePath)) cfgCases.set(inst.casePath, new Set());
    cfgCases.get(inst.casePath)!.add(inst.status);
    const sel = t.toBeCompiled.length, oth = t.otherFiles.length;
    bump(`${inst.status}: config selects ${sel === 0 ? "no unit" : oth === 0 ? "every unit" : "some units"}`);
  }
  const ucsfn = (config?.get("usecasesensitivefilenames") ?? "true").toLowerCase() !== "false";
  const fsx = buildHarnessFs(t, { libFiles: [], noLib: false, useCaseSensitiveFileNames: ucsfn });
  const input = new Map<string, MemInput>(fsx.entries);
  if (fsx.includeLibDir) input.set("/.lib/react.d.ts", { kind: "file", data: new Uint8Array(0) });
  try { new MemFs(input, ucsfn); } catch (err) {
    if (err instanceof MemFsPanic) { bump(`${inst.status}: compile-time file system panics`); notes.push(inst.casePath + ": " + err.message); } else throw err;
  }
  for (const n of fsx.entries.keys()) {
    if (n.normalize("NFC") !== n || n.normalize("NFD") !== n) { bump(`${inst.status}: name with more than one normal form`); notes.push(inst.casePath + ": " + n + " NFC equal " + (n.normalize("NFC") === n) + " NFD equal " + (n.normalize("NFD") === n)); }
  }
  // roots that are not program files
  if (t.toBeCompiled.length > 1 && t.rule !== "all" && t.rule !== "config") bump("more than one root outside the rule all");
  // noimplicitreferences values
  const nir = config?.get("noimplicitreferences");
  if (nir !== undefined) bump(`${inst.status}: noimplicitreferences = ${JSON.stringify(nir)}`);
  // last unit rule reads the text of the last unit; how often a directive alone decides
  if (t.rule === "noImplicitReferences" && t.otherFiles.length === 0) bump(`${inst.status}: noImplicitReferences with one unit`);
}
const byStatus: Record<string, number> = {};
for (const s of cfgCases.values()) { const k = [...s].sort().join("+"); byStatus[k] = (byStatus[k] ?? 0) + 1; }
console.log(JSON.stringify(c, Object.keys(c).sort(), 1));
console.log("cases with a config unit, by the statuses of their instances", JSON.stringify(byStatus), "sum", cfgCases.size);
for (const n of notes.slice(0, 20)) console.log(n);
