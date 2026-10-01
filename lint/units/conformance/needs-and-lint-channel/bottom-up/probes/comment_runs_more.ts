import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const files: string[] = [];
function walk(d: string) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } }
walk(join(root, "conformance")); walk(join(root, "compiler"));
function run(t: string, split: RegExp | string, test: (l: string) => boolean) { let r = 0; for (const l of t.split(split as any)) { if (test(l)) { if (++r >= 2) return true; } else r = 0; } return false; }
const variants: Record<string, (buf: Buffer) => boolean> = {
  "utf8, split \\n, /^\\s*\\/\\//": b => run(b.toString("utf8"), "\n", l => /^\s*\/\//.test(l)),
  "utf8, split \\n, /^[ \\t]*\\/\\//": b => run(b.toString("utf8"), "\n", l => /^[ \t]*\/\//.test(l)),
  "utf8 bom stripped, split \\n, /^[ \\t]*\\/\\//": b => run(b.toString("utf8").replace(/^\uFEFF/, ""), "\n", l => /^[ \t]*\/\//.test(l)),
  "utf8 bom stripped, split \\r?\\n, col0 //": b => run(b.toString("utf8").replace(/^\uFEFF/, ""), /\r?\n/, l => l.startsWith("//")),
  "utf8, any line break, trimmed //": b => run(b.toString("utf8"), /\r\n|\r|\n/, l => l.trimStart().startsWith("//")),
  "utf8, trimmed // and not a directive": b => run(b.toString("utf8"), "\n", l => l.trimStart().startsWith("//") && !/^\s*\/\/\s*@\w+\s*:/.test(l)),
  "utf8, grep-like ^\\s*// two lines (multiline regex, \\s spans newlines)": b => /^\s*\/\/.*\r?\n\s*\/\//m.test(b.toString("utf8")),
  "utf8, two // lines possibly separated by blank lines": b => { let prev = false; for (const l of b.toString("utf8").split("\n")) { const s = l.trim(); if (s === "") continue; const c = s.startsWith("//"); if (c && prev) return true; prev = c; } return false; },
  ".ts/.tsx only, utf8 trimmed": b => run(b.toString("utf8"), "\n", l => l.trimStart().startsWith("//")),
};
for (const [name, fn] of Object.entries(variants)) {
  let n = 0; for (const f of files) { if (name.startsWith(".ts/") && !/\.tsx?$/.test(f)) continue; if (fn(readFileSync(f))) n++; }
  console.log(n, name);
}
// markers
let m = 0, m2 = 0, byExt: Record<string, number> = {};
for (const f of files) { const t = readFileSync(f, "latin1"); if (/TODO|FIXME|XXX|HACK/.test(t)) m++; if (/\b(TODO|FIXME|XXX|HACK)\b/.test(t)) m2++; const e = f.replace(/^.*?(\.d)?(\.[^./]+)$/, "$1$2"); byExt[e] = (byExt[e] ?? 0) + 1; }
console.log("markers", m, "word-bounded", m2, byExt);
// test discovery
const disc = files.filter(f => /\.test|spec\./.test(f.slice(f.lastIndexOf("/") + 1)));
console.log("discovery matches", disc.length, disc.slice(0, 5));
