// Transpiles each listed file with the loaders js, jsx, ts, tsx and writes one JSON line per file.
// usage: [CFG=parse|dce|default|minify] bun corpus-worker.mjs <list file> <out jsonl>
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
const [listFile, outFile] = process.argv.slice(2);
const files = readFileSync(listFile, "utf8").split("\n").filter(Boolean);
// CFG=parse (default): nothing trimmed or eliminated. CFG=dce: dead code elimination on. CFG=default: the defaults of each loader.
const base = {
  parse: { trimUnusedImports: false, deadCodeElimination: false, target: "bun" },
  dce: { trimUnusedImports: false, target: "bun" },
  default: { target: "bun" },
  // Minified names depend on the order and the use counts of the symbols.
  minify: { target: "bun", minify: { identifiers: true, syntax: true, whitespace: true } },
}[process.env.CFG || "parse"];
const transpilers = {};
for (const loader of ["js", "jsx", "ts", "tsx"]) transpilers[loader] = new Bun.Transpiler({ ...base, loader });
writeFileSync(outFile, "");
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    appendFileSync(outFile, JSON.stringify({ file, skip: String(e.code || e.message) }) + "\n");
    continue;
  }
  const rec = { file, bytes: text.length, sha: Bun.hash(text).toString(16) };
  for (const loader of ["js", "jsx", "ts", "tsx"]) {
    try {
      // The transpiler names its input "input.<loader>": the name reaches the output through __filename.
      const out = transpilers[loader].transformSync(text).replaceAll(/input\.(jsx|tsx|js|ts)\b/g, "input");
      rec[loader] = { ok: true, h: Bun.hash(out).toString(16), n: out.length };
    } catch (e) {
      const errs = e && e.errors ? e.errors : [e];
      rec[loader] = {
        ok: false,
        errors: errs.slice(0, 3).map(x => ({ m: String(x && x.message), line: x?.position?.line, col: x?.position?.column, text: x?.position?.lineText?.slice(0, 200) })),
      };
    }
  }
  appendFileSync(outFile, JSON.stringify(rec) + "\n");
}
