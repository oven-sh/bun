// Builds a corpus of the single-file units of TypeScript's own tests: each `// @filename` part is one source.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const out = [];
const seen = new Set();
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(name) && st.size < 60000) {
      const text = readFileSync(p, "utf8");
      const parts = text.split(/^\s*\/\/\s*@filename:\s*(.*)$/im);
      // parts: [head, name1, body1, name2, body2...]
      const units = parts.length === 1 ? [[name, text]] : parts.slice(1).reduce((acc, cur, i, arr) => (i % 2 === 0 ? acc.concat([[cur.trim(), arr[i + 1] ?? ""]]) : acc), []);
      for (const [unit, body] of units) {
        if (!/\.(ts|tsx|mts|cts)$/.test(unit) || /\.d\.[mc]?ts$/.test(unit)) continue;
        const src = body.replace(/^\uFEFF/, "");
        if (!src.trim() || seen.has(src)) continue;
        seen.add(src);
        out.push({ src, prod: p.slice(ROOT.length + 1) + (parts.length === 1 ? "" : "#" + unit), tsx: /\.tsx$/.test(unit) });
      }
    }
  }
}
walk(join(ROOT, "compiler"));
walk(join(ROOT, "conformance"));
writeFileSync("/tmp/a1bu/p/tscases.json", JSON.stringify(out));
console.log(out.length, "units", out.filter(o => o.tsx).length, "tsx");
