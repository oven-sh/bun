// usage: <bun> bun-run.mjs > bun.json   (run with the base build)
import { inputs } from "./inputs.mjs";
const opts = loader => ({ loader, trimUnusedImports: false, target: "bun", deadCodeElimination: false, inline: false });
const T = { js: new Bun.Transpiler(opts("js")), jsx: new Bun.Transpiler(opts("jsx")), ts: new Bun.Transpiler(opts("ts")), tsx: new Bun.Transpiler(opts("tsx")) };
const out = {};
for (const [id, code] of inputs) {
  const row = {};
  for (const l of ["js", "jsx", "ts", "tsx"]) {
    try { row[l] = { ok: true, out: T[l].transformSync(code).replace(/"input\.[jt]sx?"/g, '"input.X"') }; }
    catch (e) { row[l] = { ok: false, err: (e?.errors ?? [e]).map(x => `${x?.position?.line ?? "?"}:${x?.position?.column ?? "?"} ${x?.message ?? String(x)}`) }; }
  }
  out[id] = row;
}
console.log(JSON.stringify({ revision: Bun.revision, version: Bun.version, rows: out }, null, 1));
