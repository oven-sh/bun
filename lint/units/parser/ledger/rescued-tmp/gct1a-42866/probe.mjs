// Usage: bun probe.mjs <cases.txt> [--tsx] [--out] [--only=TAG]
// One case per line; "\n" inside a line is written as the two characters \n; lines starting with # are comments.
import { readFileSync } from "node:fs";
import ts from "/workspace/bun/node_modules/typescript/lib/typescript.js";
const file = process.argv[2];
const tsx = process.argv.includes("--tsx");
const showOut = process.argv.includes("--out");
const only = process.argv.find(a => a.startsWith("--only="))?.slice(7);
const lines = readFileSync(file, "utf8")
  .split("\n")
  .filter(l => l.trim() && !l.startsWith("#"));
const tr = new Bun.Transpiler({ loader: tsx ? "tsx" : "ts" });
const counts = {};
for (const raw of lines) {
  const code = raw.replaceAll("\\n", "\n");
  const sf = ts.createSourceFile(tsx ? "a.tsx" : "a.ts", code, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const diags = sf.parseDiagnostics.map(d => `TS${d.code}@${d.start}+${d.length}:${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  let bun = "OK";
  let out = "";
  try {
    out = tr.transformSync(code);
  } catch (e) {
    bun = "ERR: " + String(e?.errors?.map?.(x => x.message).join(" | ") ?? e.message ?? e).slice(0, 160);
  }
  const tscOk = diags.length === 0;
  const bunOk = bun === "OK";
  const cls = tscOk && bunOk ? "both-ok" : tscOk && !bunOk ? "TSC-ONLY" : !tscOk && bunOk ? "BUN-ONLY" : "both-err";
  counts[cls] = (counts[cls] ?? 0) + 1;
  if (only && only !== cls) continue;
  let line = `${cls.padEnd(9)} ${raw}`;
  if (!tscOk) line += `\n      tsc: ${diags.slice(0, 2).join(" ; ")}`;
  if (!bunOk) line += `\n      bun: ${bun}`;
  if (showOut && bunOk) line += `\n      out: ${JSON.stringify(out)}`;
  console.log(line);
}
console.log(JSON.stringify(counts));
