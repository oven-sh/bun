import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const files: string[] = [];
function walk(d: string) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } }
walk(join(root, "conformance")); walk(join(root, "compiler"));
const re = /^\/\/\s*@(\w+)\s*:\s*([^\r\n]*)/gm;
const counts: Record<string, number> = {};
const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
let maxDirectiveBytes = 0, maxCase = "";
const optionNames = new Map<string, number>();
for (const f of files) {
  const t = readFileSync(f, "utf8");
  const seen = new Set<string>();
  let bytes = 0;
  for (const m of t.matchAll(re)) {
    const name = m[1].toLowerCase(); const value = m[2].trim();
    if (name === "filename") {
      const base = value.split(/[\\/]/).pop()!.toLowerCase();
      if (base === "tsconfig.json") seen.add("unit tsconfig.json");
      else if (base === "jsconfig.json") seen.add("unit jsconfig.json");
      else if (base === "package.json") seen.add("unit package.json");
      else if (base === "bunfig.toml") seen.add("unit bunfig.toml");
      else if (base.startsWith(".env")) seen.add("unit .env*");
      else if (/^tsconfig.*\.json$/.test(base)) seen.add("unit tsconfig*.json (other)");
      if (/(^|[\\/])node_modules[\\/]/.test(value)) seen.add("unit under node_modules");
    } else {
      bytes += name.length + value.length + 8;
      if (name !== "link" && name !== "symlink") optionNames.set(name, (optionNames.get(name) ?? 0) + 1);
      if (name === "link" || name === "symlink") seen.add("has @link/@symlink");
    }
  }
  for (const s of seen) bump(s);
  if (bytes > maxDirectiveBytes) { maxDirectiveBytes = bytes; maxCase = f.slice(root.length + 1); }
}
console.log(JSON.stringify({ cases: files.length, ...counts, maxDirectiveBytes, maxCase, distinctDirectiveNames: optionNames.size }, null, 1));
