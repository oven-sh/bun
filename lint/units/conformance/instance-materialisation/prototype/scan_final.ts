// Research probe: the status of each run instance for a check function that reads the disk, by platform.
import { buildHarnessFs, newCompilerTest } from "./compiler_test";
import { enumerateInstances } from "./enum_runner";
import { readFile } from "./readfile";
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const e = enumerateInstances({ casesRoot });
const cache = new Map<string, string>();
// a quoted absolute path where a file is named: import, export from, require, import(), reference path
export const absoluteReference = /(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\(|\bpath\s*=)\s*(["'`])((?:\/(?!\/)|[a-zA-Z]:[\\\/])[^"'`\r\n]*)\1/;
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
interface P { name: string; caseSensitive: boolean; links: boolean; windows: boolean }
const platforms: P[] = [
  { name: "linux", caseSensitive: true, links: true, windows: false },
  { name: "macos", caseSensitive: false, links: true, windows: false },
  { name: "windows with links", caseSensitive: false, links: true, windows: true },
  { name: "windows without links", caseSensitive: false, links: false, windows: true },
];
const table: Record<string, Record<string, number>> = {};
const kinds: Record<string, Record<string, Record<string, number>>> = {};
const single: Record<string, number> = {};
const singleCases: Record<string, Set<string>> = {};
for (const p of platforms) { table[p.name] = {}; kinds[p.name] = {}; }
for (const inst of e.instances) {
  if (inst.status !== "run") continue;
  const file = casesRoot + "/" + inst.casePath;
  let content = cache.get(file);
  if (content === undefined) { content = readFile(file).contents; cache.set(file, content); }
  const config = inst.config === undefined ? undefined : new Map(inst.config);
  const r = newCompilerTest(content, file, config);
  const kind = "?";
  if (!r.ok) { for (const p of platforms) table[p.name][r.status] = (table[p.name][r.status] ?? 0) + 1; continue; }
  const t = r.value;
  const ucsfn = (config?.get("usecasesensitivefilenames") ?? "true").toLowerCase() !== "false";
  const fsx = buildHarnessFs(t, { libFiles: [], noLib: false, useCaseSensitiveFileNames: ucsfn });
  const names = [...fsx.entries.keys(), t.currentDirectory];
  const causes = new Set<string>();
  if (names.some(n => /^[a-zA-Z]:/.test(n))) causes.add("drive-root");
  if ([...t.toBeCompiled, ...t.otherFiles].some(u => absoluteReference.test(u.content))) causes.add("absolute-reference");
  if (!ucsfn) causes.add("case-insensitive-instance");
  const seen = new Map<string, string>();
  for (const n of names) { let prefix = ""; for (const part of n.split("/").slice(1)) { prefix += "/" + part; const k = prefix.toLowerCase(); const o = seen.get(k); if (o !== undefined && o !== prefix) causes.add("case-clash"); seen.set(k, prefix); } }
  if (names.some(n => n.replace(/^[a-zA-Z]:/, "").split("/").some(part => part !== "" && (/[<>:"|?*\u0000-\u001f\\]/.test(part) || /[. ]$/.test(part) || reserved.test(part))))) causes.add("windows-name");
  if ([...fsx.entries.values()].some(x => x.kind === "symlink")) causes.add("links");
  for (const c of causes) { single[c] = (single[c] ?? 0) + 1; (singleCases[c] ??= new Set()).add(inst.casePath); }
  for (const p of platforms) {
    // one status for an instance, the first cause in this order
    let status = "materialised";
    if (causes.has("drive-root")) status = "drive-root";
    else if (causes.has("absolute-reference")) status = "absolute-reference";
    else if (causes.has("case-insensitive-instance") && p.caseSensitive) status = "case-insensitive-instance";
    else if (causes.has("case-clash") && !p.caseSensitive) status = "case-clash";
    else if (causes.has("windows-name") && p.windows) status = "windows-name";
    else if (causes.has("links") && !p.links) status = "links-unavailable";
    table[p.name][status] = (table[p.name][status] ?? 0) + 1;
  }
}
console.log("run instances by cause, causes counted alone:", JSON.stringify(single));
console.log("cases by cause:", JSON.stringify(Object.fromEntries(Object.entries(singleCases).map(([k, v]) => [k, v.size]))));
for (const p of platforms) console.log(p.name, JSON.stringify(table[p.name]));
