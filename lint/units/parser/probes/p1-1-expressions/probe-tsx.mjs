import { readFileSync } from "node:fs";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const inputs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const tr = new Bun.Transpiler({ loader: "tsx" });
for (const src of inputs) {
  const sf = ts.createSourceFile("/i.tsx", src, ts.ScriptTarget.ESNext, false, ts.ScriptKind.TSX);
  const p = sf.parseDiagnostics.map(d => "TS" + d.code + "@" + d.start);
  let b; try { b = "OK  " + tr.transformSync(src).trim().replace(/\s+/g, " "); } catch (e) { b = "ERR " + (e.errors?.[0]?.message ?? e.message).split("\n")[0]; }
  console.log(JSON.stringify(src).padEnd(52), "| tsc.tsx:", (p.join(",") || "ok").padEnd(12), "| bun.tsx:", b);
}
