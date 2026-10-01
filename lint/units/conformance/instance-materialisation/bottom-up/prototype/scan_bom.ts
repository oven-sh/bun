import { readFileSync } from "node:fs";
import { enumerateFiles } from "./enum_runner";
import { readFile } from "./readfile";
import { parseTestFilesAndSymlinks } from "./test_case_parser";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const files = [...enumerateFiles(root + "/compiler", true), ...enumerateFiles(root + "/conformance", true)];
const c: Record<string, string[]> = {};
const add = (k: string, v: string) => (c[k] ??= []).push(v);
let units = 0, bytes = 0, maxUnit = 0;
for (const f of files) {
  const b = readFileSync(f);
  const rel = f.slice(root.length + 1);
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) add("utf16le", rel);
  else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) add("utf16be", rel);
  else if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) add("utf8 bom", rel);
  const r = readFile(f);
  const p = parseTestFilesAndSymlinks(r.contents, f, (name, content) => ({ value: { name, content }, error: undefined }));
  if (!p.ok) continue;
  for (const u of p.units) {
    units++;
    const n = Buffer.byteLength(u.content, "utf8");
    bytes += n; maxUnit = Math.max(maxUnit, n);
    if (u.content.startsWith("\ufeff")) add("unit starts with U+FEFF", rel + " " + u.name);
    if (u.content.includes("\ufeff")) add("unit holds U+FEFF", rel + " " + u.name);
    if (u.content.includes("\r")) add("unit holds CR", rel);
    if (u.content.includes("\u0000")) add("unit holds NUL", rel);
    if (!u.content.isWellFormed()) add("unit is not well formed UTF-16", rel);
    if (u.name !== u.name.trim()) add("name with outer white space", rel + " " + JSON.stringify(u.name));
    if (/[\u0000-\u001f]/.test(u.name)) add("name with a control character", rel + " " + JSON.stringify(u.name));
  }
}
console.log(JSON.stringify({ files: files.length, units, bytes, maxUnit }));
for (const [k, v] of Object.entries(c)) console.log(k, new Set(v).size, [...new Set(v)].slice(0, 6).join(" | "));
