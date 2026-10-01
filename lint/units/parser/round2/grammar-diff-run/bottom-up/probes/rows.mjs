// <bun under test> rows.mjs <rows.reject.json>: per row what the binary that runs this file does: "A" or the first error message.
import { readFileSync } from "node:fs";
const tsconfig = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const transpilers = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }), decorators: new Bun.Transpiler({ loader: "ts", tsconfig }) };
const out = [];
for (const [group, rows] of JSON.parse(readFileSync(process.argv[2], "utf8"))) {
  for (const [t, src] of rows) {
    let result;
    try { transpilers[t].transformSync(src); result = "A"; } catch (e) { const list = e && Array.isArray(e.errors) && e.errors.length ? e.errors : [e]; result = String(list[0]?.message ?? list[0]); }
    out.push([group, t, src, result]);
  }
}
console.log(JSON.stringify(out));
