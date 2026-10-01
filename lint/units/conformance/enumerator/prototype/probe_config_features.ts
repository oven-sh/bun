// Which features of the config reader the corpus reaches (research probe).
import { enumerateFiles, skippedTests } from "./compiler_runner";
import { getConfigNameFromFileName, parseTestFilesAndSymlinks } from "./test_case_parser";
import { parseJsonc, type JsonNode } from "./tsconfig";
import { getBaseFileName } from "./tspath";
import { readFile } from "./vfs";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const eight = ["module", "moduleResolution", "esModuleInterop", "allowSyntheticDefaultImports", "baseUrl", "outFile", "target", "alwaysStrict"];
const c: Record<string, number> = { configUnits: 0, inSkippedTests: 0, jsconfig: 0, upperCaseName: 0, rootNotObject: 0, noCompilerOptions: 0, compilerOptionsNotObject: 0, setsOneOfEight: 0, nullValue: 0, configDir: 0, duplicateKey: 0, wrongCaseKey: 0, wrongType: 0, unknownEnum: 0, extendsKey: 0, secondConfigUnit: 0, symlinks: 0, relativeName: 0, dosName: 0, currentDirectory: 0 };
const values = new Map<string, number>();
const detail: string[] = [];
for (const f of [...enumerateFiles(root + "/compiler", true), ...enumerateFiles(root + "/conformance", true)]) {
  const text = readFile(f).contents;
  const p = parseTestFilesAndSymlinks(text, f, (name, content) => ({ value: { name, content }, error: undefined }));
  if (!p.ok) continue;
  const cfgs = p.units.filter(u => getConfigNameFromFileName(u.name) !== "");
  if (cfgs.length === 0) continue;
  c.configUnits++;
  const rel = f.slice(root.length + 1);
  if (skippedTests.includes(getBaseFileName(f))) c.inSkippedTests++;
  if (cfgs.length > 1) { c.secondConfigUnit++; detail.push("second config unit: " + rel + " " + cfgs.map(u => u.name).join(", ")); }
  const u = cfgs[0];
  const base = getBaseFileName(u.name);
  if (base.toLowerCase() === "jsconfig.json") c.jsconfig++;
  if (base !== base.toLowerCase()) { c.upperCaseName++; detail.push("upper case config name: " + rel + " " + u.name); }
  if (p.symlinks.size > 0) c.symlinks++;
  if (!/^(\/|[a-zA-Z]:)/.test(u.name)) c.relativeName++;
  if (/^[a-zA-Z]:/.test(u.name)) c.dosName++;
  if (p.currentDirectory !== "") { c.currentDirectory++; detail.push("currentDirectory: " + rel + " " + p.currentDirectory); }
  const node = parseJsonc(u.content);
  if (node === undefined) { detail.push("unparsed: " + rel); continue; }
  if (node.kind !== "object") { c.rootNotObject++; detail.push("root is " + node.kind + ": " + rel); continue; }
  const keys = node.properties.map(x => x.key);
  if (new Set(keys).size !== keys.length) { c.duplicateKey++; detail.push("duplicate root key: " + rel); }
  if (keys.includes("extends")) c.extendsKey++;
  const co = node.properties.filter(x => x.key === "compilerOptions");
  if (co.length === 0) { c.noCompilerOptions++; continue; }
  const last = co[co.length - 1].value;
  if (last.kind !== "object") { c.compilerOptionsNotObject++; detail.push("compilerOptions is " + last.kind + ": " + rel); continue; }
  const ck = last.properties.map(x => x.key);
  if (new Set(ck).size !== ck.length) { c.duplicateKey++; detail.push("duplicate compilerOptions key: " + rel); }
  let any = false;
  for (const pr of last.properties) {
    const lower = eight.find(x => x.toLowerCase() === pr.key.toLowerCase());
    if (lower === undefined) continue;
    if (lower !== pr.key) { c.wrongCaseKey++; detail.push(`key in another case: ${rel} ${pr.key}`); continue; }
    any = true;
    const v = pr.value;
    const shown = v.kind === "string" ? JSON.stringify(v.value) : v.kind === "number" ? String(v.value) : v.kind;
    values.set(pr.key + " = " + shown, (values.get(pr.key + " = " + shown) ?? 0) + 1);
    if (v.kind === "null") { c.nullValue++; detail.push(`null: ${rel} ${pr.key}`); }
    if (v.kind === "string" && v.value.toLowerCase().startsWith("${configdir}")) c.configDir++;
    const wantString = ["module", "moduleResolution", "target", "baseUrl", "outFile"].includes(pr.key);
    if (v.kind !== "null" && (wantString ? v.kind !== "string" : v.kind !== "true" && v.kind !== "false")) { c.wrongType++; detail.push(`wrong type: ${rel} ${pr.key} is ${v.kind}`); }
  }
  if (any) c.setsOneOfEight++;
}
console.log(JSON.stringify(c, null, 0));
for (const [k, v] of [...values].sort()) console.log(String(v).padStart(4), k);
for (const d of detail) console.log(d);
