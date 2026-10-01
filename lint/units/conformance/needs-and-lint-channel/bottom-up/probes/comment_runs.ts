import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const files: string[] = [];
function walk(d: string) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } }
walk(join(root, "conformance")); walk(join(root, "compiler"));
function isCommentLine(line: string) { const t = line.trimStart(); return t.startsWith("//") || t.startsWith("/*") || t === "*" || t === "*/" || t.startsWith("* "); }
let a = 0, b = 0, c = 0, d = 0, boms = 0, m = 0;
for (const f of files) {
  const buf = readFileSync(f);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) boms++;
  const t = buf.toString("utf8");
  let r = 0, hit = false, r2 = 0, hit2 = false, onlyDirective = true; let run: string[] = [];
  const flush = () => { if (run.length >= 2 && !run.every(l => /^\s*\/\/\s*@\w+\s*:/.test(l))) onlyDirective = false; run = []; };
  for (const l of t.split("\n")) {
    if (l.trimStart().startsWith("//")) { run.push(l); if (++r >= 2) hit = true; } else { r = 0; flush(); }
    if (isCommentLine(l)) { if (++r2 >= 2) hit2 = true; } else r2 = 0;
  }
  flush();
  if (hit) a++;
  if (hit2) b++;
  if (hit && onlyDirective) c++;
  if (/TODO|FIXME|XXX|HACK/.test(t)) m++;
}
console.log(JSON.stringify({ files: files.length, utf8Bom: boms, slashRunUtf8: a, commentCopRunUtf8: b, onlyDirectiveRuns: c, markers: m }));
