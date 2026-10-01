// <bun under test> one.mjs <sources.txt> : per line of the file (U+23CE is a line break) the result of four apis, as JSON lines.
import { readFileSync } from "node:fs";
const DECO = { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } };
const apis = { ts: { loader: "ts" }, tsx: { loader: "tsx" }, deco: { loader: "ts", tsconfig: DECO } };
const tr = Object.fromEntries(Object.entries(apis).map(([k, o]) => [k, new Bun.Transpiler(o)]));
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  if (!line || line.startsWith("# ")) continue;
  const src = line.replaceAll("\u23ce", "\n");
  const out = { src };
  for (const k of Object.keys(apis)) {
    try {
      out[k] = ["o", tr[k].transformSync(src)];
    } catch (e) {
      const list = e && Array.isArray(e.errors) && e.errors.length ? e.errors : [e];
      out[k] = ["e", list.map(x => String(x?.message ?? x))];
    }
  }
  console.log(JSON.stringify(out));
}
