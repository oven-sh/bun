import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const files: string[] = [];
function walk(d: string) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } }
walk(join(root, "conformance")); walk(join(root, "compiler"));
const variants: Record<string, (t: string) => boolean> = {
  "lf-split, trimmed //": t => { let r = 0; for (const l of t.split("\n")) { if (l.trimStart().startsWith("//")) { if (++r >= 2) return true; } else r = 0; } return false; },
  "lf-split, col0 //": t => { let r = 0; for (const l of t.split("\n")) { if (l.startsWith("//")) { if (++r >= 2) return true; } else r = 0; } return false; },
  "lf-split, contains // anywhere": t => { let r = 0; for (const l of t.split("\n")) { if (l.includes("//")) { if (++r >= 2) return true; } else r = 0; } return false; },
  "lf-split, trimmed // or /* or *": t => { let r = 0; for (const l of t.split("\n")) { const s = l.trim(); if (s.startsWith("//") || s.startsWith("/*") || s.startsWith("*")) { if (++r >= 2) return true; } else r = 0; } return false; },
  "lf-split, trimmed // (bom stripped)": t => { let r = 0; t = t.replace(/^\xef\xbb\xbf/, ""); for (const l of t.split("\n")) { if (l.trimStart().startsWith("//")) { if (++r >= 2) return true; } else r = 0; } return false; },
  "regex /(^[ \\t]*\\/\\/.*\\n){2}/m": t => /(^[ \t]*\/\/.*\n){2}/m.test(t),
  "regex two // lines incl. last without newline": t => /^[ \t]*\/\/.*\r?\n[ \t]*\/\//m.test(t),
};
for (const [name, fn] of Object.entries(variants)) {
  let n = 0; for (const f of files) if (fn(readFileSync(f, "latin1"))) n++;
  console.log(n, name);
}
