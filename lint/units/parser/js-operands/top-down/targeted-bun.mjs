// Transpiles every targeted input with the loaders js, jsx, ts, tsx of the bun that runs this script.
// usage: bun targeted-bun.mjs [inputs.json] > targeted-bun.jsonl
import { readFileSync } from "node:fs";
const inputs = JSON.parse(readFileSync(process.argv[2] || new URL("./targeted-inputs.json", import.meta.url), "utf8"));
const base = { trimUnusedImports: false, deadCodeElimination: false, target: "bun" };
const transpilers = {};
for (const loader of ["js", "jsx", "ts", "tsx"]) transpilers[loader] = new Bun.Transpiler({ ...base, loader });
for (const [group, list] of Object.entries(inputs)) {
  for (const src of list) {
    const rec = { group, src };
    for (const loader of ["js", "jsx", "ts", "tsx"]) {
      try {
        rec[loader] = { ok: true, out: transpilers[loader].transformSync(src).replaceAll(/input\.(jsx|tsx|js|ts)\b/g, "input").trim() };
      } catch (e) {
        const errs = e && e.errors ? e.errors : [e];
        rec[loader] = { ok: false, errors: errs.map(x => String(x && x.message)) };
      }
    }
    console.log(JSON.stringify(rec));
  }
}
