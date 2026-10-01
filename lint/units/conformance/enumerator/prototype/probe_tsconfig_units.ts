// Lists the cases that hold a tsconfig.json or jsconfig.json unit (research probe).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "./vfs";
import { makeUnitsFromTest, parseTestFilesAndSymlinks, getConfigNameFromFileName } from "./test_case_parser";

const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
function walk(dir: string, out: string[]) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
  for (const e of entries) {
    const p = dir + "/" + e.name;
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
}
const files: string[] = [];
walk(join(root, "compiler"), files);
walk(join(root, "conformance"), files);
let n = 0, withExtends = 0;
const relevant = /"(module|moduleResolution|esModuleInterop|allowSyntheticDefaultImports|baseUrl|outFile|target|alwaysStrict|extends)"/;
let rel = 0;
for (const f of files) {
  const r = readFile(f);
  const parsed = parseTestFilesAndSymlinks(r.contents, f, (name, content) => ({ value: { name, content }, error: undefined }));
  if (!parsed.ok) { console.log("PANIC", f, parsed.reason); continue; }
  const cfgUnits = parsed.units.filter(u => getConfigNameFromFileName(u.name) !== "");
  if (cfgUnits.length === 0) continue;
  n++;
  const first = cfgUnits[0];
  const isRel = relevant.test(first.content);
  if (isRel) rel++;
  const ext = /"extends"/.test(first.content);
  if (ext) withExtends++;
  console.log([f.slice(root.length + 1), cfgUnits.length, first.name, isRel ? "relevant" : "-", ext ? "EXTENDS" : "-", parsed.currentDirectory || "-"].join("\t"));
}
console.error("cases with config unit:", n, "relevant:", rel, "extends:", withExtends, "files:", files.length);
