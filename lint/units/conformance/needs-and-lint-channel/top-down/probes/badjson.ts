// Units named package.json, tsconfig.json or jsconfig.json whose text is no JSON (rough split on the filename directive).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
function* walk(d: string): Generator<string> { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) yield* walk(p); else yield p; } }
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases/";
let units = 0, bad = 0, badFiles = new Set<string>(); const kinds: Record<string, number> = {}; const badKinds: Record<string, number> = {};
for (const dir of ["conformance", "compiler"]) for (const f of walk(root + dir)) {
  const text = readFileSync(f, "utf8");
  const lines = text.split(/\r?\n/);
  let name: string | undefined, buf: string[] = [];
  const flush = () => {
    if (name !== undefined) {
      const base = name.slice(name.lastIndexOf("/") + 1).toLowerCase();
      if (base === "package.json" || base === "tsconfig.json" || base === "jsconfig.json") {
        units++; kinds[base] = (kinds[base] ?? 0) + 1;
        try { JSON.parse(buf.join("\n")); } catch { bad++; badKinds[base] = (badKinds[base] ?? 0) + 1; badFiles.add(f.slice(root.length)); }
      }
    }
    buf = [];
  };
  for (const l of lines) {
    const m = /^\/\/\s*@filename\s*:\s*(.*?)\s*$/i.exec(l);
    if (m) { flush(); name = m[1]; } else if (!/^\/\/\s*@\w+\s*:/.test(l)) buf.push(l);
  }
  flush();
}
console.log(JSON.stringify({ units, kinds, notStrictJson: bad, badKinds, caseFiles: badFiles.size, sample: [...badFiles].slice(0, 5) }));
