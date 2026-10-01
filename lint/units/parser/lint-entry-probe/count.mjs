import { readFileSync } from "node:fs";
const root = "/workspace/wt/parser/";
const list = (await Bun.$`git -C ${root} ls-files test src/js`.text()).split("\n").filter(f => /\.(ts|tsx|mts|cts)$/.test(f));
let bytes = 0, ok = 0, fail = 0, dts = 0, tsx = 0, deco = 0; const fails = new Map();
const t0 = performance.now();
for (const f of list) {
  let src; try { src = readFileSync(root + f, "utf8"); } catch { continue; }
  bytes += src.length;
  const loader = f.endsWith(".tsx") ? "tsx" : "ts";
  if (/\.d\.(ts|mts|cts)$/.test(f)) dts++;
  if (loader === "tsx") tsx++;
  if (/^\s*@[A-Za-z_$][\w$.]*\s*(\(|$)/m.test(src)) deco++;
  try { new Bun.Transpiler({ loader }).transformSync(src); ok++; } catch (e) { fail++; const m = String((e?.errors?.[0] ?? e).message).replace(/"[^"]*"/g, '"…"').slice(0, 80); fails.set(m, (fails.get(m) ?? 0) + 1); }
}
console.log(JSON.stringify({ files: list.length, bytes, ok, fail, dts, tsx, deco, ms: Math.round(performance.now() - t0) }));
console.log([...fails].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => v + "  " + k).join("\n"));
