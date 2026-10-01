import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const files: string[] = [];
function walk(d: string) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } }
walk(join(root, "conformance")); walk(join(root, "compiler"));
const ok = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;
const extCount = new Map<string, number>(); const caseWithOther = new Set<string>(); const otherExt = new Map<string, number>();
for (const f of files) {
  const t = readFileSync(f, "utf8");
  const names = [...t.matchAll(/^\/\/\s*@filename\s*:\s*([^\r\n]*)/gim)].map(m => m[1].trim());
  if (names.length === 0) names.push(f);
  for (const n of names) {
    const base = n.split(/[\\/]/).pop()!;
    const m = /\.[^.]*$/.exec(base); const ext = m ? m[0].toLowerCase() : "(none)";
    extCount.set(ext, (extCount.get(ext) ?? 0) + 1);
    if (!ok.test(base) && ext !== ".json" && ext !== ".tsbuildinfo") { caseWithOther.add(f); otherExt.set(ext, (otherExt.get(ext) ?? 0) + 1); }
  }
}
console.log("unit extensions:", [...extCount].sort((a, b) => b[1] - a[1]).map(([e, n]) => `${e} ${n}`).join(", "));
console.log("cases with a non-json unit whose extension is none of ts tsx js jsx mjs cjs mts cts:", caseWithOther.size);
console.log([...otherExt].sort((a, b) => b[1] - a[1]).map(([e, n]) => `${e} ${n}`).join(", "));
