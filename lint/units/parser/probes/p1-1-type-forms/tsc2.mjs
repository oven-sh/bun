import ts from "/workspace/bun/node_modules/typescript/lib/typescript.js";
import { readFileSync } from "node:fs";
const inputs = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const src of inputs) {
  const sf = ts.createSourceFile("/input.ts", src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const d = sf.parseDiagnostics.map(d => `TS${d.code}@${d.start}+${d.length}`);
  let bun;
  try { new Bun.Transpiler({ loader: "ts" }).transformSync(src); bun = "ok"; } catch (e) { bun = "ERR " + String(e?.errors?.[0]?.message ?? e.message).split("\n")[0]; }
  console.log((d.length ? "REJECT " : "PARSES ") + JSON.stringify(src).padEnd(60) + " tsc: " + (d.join(" ") || "-") + "   | bun(old): " + bun);
}
