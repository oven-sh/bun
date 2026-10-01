// Classifies the config units: strict JSON, JSON with comments or trailing commas, or malformed (research probe).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "./vfs";
import { parseTestFilesAndSymlinks, getConfigNameFromFileName } from "./test_case_parser";

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
function stripJsonc(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') { if (s[j] === "\\") j++; j++; }
      out += s.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === "/" && s[i + 1] === "/") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === "/" && s[i + 1] === "*") { const e = s.indexOf("*/", i + 2); i = e < 0 ? s.length : e + 2; continue; }
    out += c; i++;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}
const cls: Record<string, string[]> = { strict: [], jsonc: [], malformed: [] };
for (const f of files) {
  const r = readFile(f);
  const parsed = parseTestFilesAndSymlinks(r.contents, f, (name, content) => ({ value: { name, content }, error: undefined }));
  if (!parsed.ok) continue;
  // every json unit matters for extends; the first config unit matters for the case
  const cfg = parsed.units.find(u => getConfigNameFromFileName(u.name) !== "");
  if (!cfg) continue;
  const rel = f.slice(root.length + 1);
  try { JSON.parse(cfg.content); cls.strict.push(rel); continue; } catch {}
  try { JSON.parse(stripJsonc(cfg.content)); cls.jsonc.push(rel); continue; } catch (e) { cls.malformed.push(rel + "\t" + JSON.stringify(cfg.content.slice(0, 300))); }
}
for (const [k, v] of Object.entries(cls)) console.log(k, v.length);
console.log("--- jsonc"); for (const x of cls.jsonc) console.log(x);
console.log("--- malformed"); for (const x of cls.malformed) console.log(x);
