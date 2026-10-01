// usage: <bun> pattern-count.mjs <root...>  : how many JavaScript files hold the shapes that only the TypeScript grammar treats specially.
import { Glob } from "bun";
import { readFileSync, statSync } from "fs";
import { join } from "path";
const pats = {
  "paren-colon-ident-arrow  `? (x) : y =>`": /\?\s*\([^()]*\)\s*:\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*=>/,
  "case-paren-colon-arrow   `case (x): y =>`": /\bcase\s*\([^()]*\)\s*:\s*[A-Za-z_$][\w$]*\s*=>/,
  "lt-ident-gt-paren        `a < b > (`": /[\w$\])]\s*<\s*[A-Za-z_$][\w$.]*\s*>\s*\(/,
  "class-modifier-newline   `public\\n x`": /^\s*(?:public|private|protected|readonly|override)\s*\n\s*(?:[\w$#\['"*]|static)/m,
  "jsx-extends-attr         `<A extends b`": /<[A-Za-z_$][\w$.]*\s+extends\s+[A-Za-z_$]/,
};
const counts = Object.fromEntries(Object.keys(pats).map(k => [k, { files: 0, eg: [] }]));
let files = 0;
for (const root of process.argv.slice(2)) {
  for (const ext of ["js", "mjs", "cjs", "jsx"]) {
    for (const rel of new Glob(`**/*.${ext}`).scanSync({ cwd: root, dot: true, followSymlinks: false })) {
      const path = join(root, rel);
      let code;
      try { if (statSync(path).size > 4_000_000) continue; code = readFileSync(path, "utf8"); } catch { continue; }
      files++;
      for (const [k, re] of Object.entries(pats)) {
        const m = re.exec(code);
        if (m) { counts[k].files++; if (counts[k].eg.length < 4) counts[k].eg.push(`${path.replace("/workspace/wt/parser/", "")}: ${JSON.stringify(m[0].slice(0, 60))}`); }
      }
    }
  }
}
console.log(JSON.stringify({ files, counts }, null, 1));
