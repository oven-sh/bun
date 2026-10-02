// usage: <bun> run.mjs <cases.json>  -> prints JSON lines {loader, source, ok, out|err}
import { readFileSync } from "node:fs";
const cases = JSON.parse(readFileSync(process.argv[2], "utf8"));
const loaders = ["ts", "tsx", "js"];
const t = Object.fromEntries(loaders.map(l => [l, new Bun.Transpiler({ loader: l })]));
for (const c of cases) {
  const [source, which] = Array.isArray(c) ? c : [c, ["ts"]];
  for (const l of which) {
    let r;
    try { r = { ok: true, out: t[l].transformSync(source) }; }
    catch (e) { r = { ok: false, err: (e.errors ? e.errors.map(x => x.message ?? String(x)).join(" | ") : String(e.message ?? e)).slice(0, 200) }; }
    console.log(JSON.stringify({ loader: l, source, ...r }));
  }
}
