// usage: node go.cjs <file with one JSON string per line, optional prefix js:/tsx:/jsx:/ts:> [max]
// prints the parse diagnostics of typescript-go (/tmp/rr/parsediag, byte offsets) and says where the first one of tsc 6.0.2 differs
const ts = require("/workspace/bun/node_modules/typescript");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
const lines = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(l => l && !l.startsWith("#"));
const max = Number(process.argv[3] ?? 3);
const inputs = lines.map((line, id) => {
  let loader = "ts", rest = line;
  const m = /^(ts|tsx|js|jsx):(.*)$/s.exec(line);
  if (m) { loader = m[1]; rest = m[2]; }
  return { id, loader, code: JSON.parse(rest) };
});
const p = spawnSync("/tmp/rr/parsediag", ["-max", "8"], { input: inputs.map(r => JSON.stringify({ id: r.id, name: "input." + r.loader, text: r.code })).join("\n") + "\n", maxBuffer: 1 << 28 });
const go = new Map();
for (const line of String(p.stdout).split("\n")) { if (!line) continue; const r = JSON.parse(line); go.set(r.id, r); }
let differ = 0;
for (const i of inputs) {
  const g = go.get(i.id);
  const sf = ts.createSourceFile("x." + i.loader, i.code, ts.ScriptTarget.Latest, false, kinds[i.loader]);
  const b = off => Buffer.byteLength(i.code.slice(0, off));
  const t = sf.parseDiagnostics.map(d => [d.code, b(d.start), b(d.start + d.length) - b(d.start), ts.flattenDiagnosticMessageText(d.messageText, "\n")]);
  const gd = g?.d ?? [];
  const same = JSON.stringify(t[0] ?? null) === JSON.stringify(gd[0] ?? null);
  if (!same) differ++;
  console.log(JSON.stringify(i.code), "[" + i.loader + "]" + (same ? "" : "   <<< tsc and go differ on the first diagnostic"));
  if (!g) console.log("   go  NO OUTPUT");
  if (g?.panic) console.log("   go  PANIC " + g.panic.slice(0, 100));
  for (const d of gd.slice(0, max)) console.log(`   go  @${d[1]}+${d[2]} TS${d[0]} ${d[3]}   <<${Buffer.from(i.code).subarray(d[1], d[1] + d[2]).toString()}>>`);
  if (g && !g.panic && !gd.length) console.log("   go  parses");
  if (!same) { for (const d of t.slice(0, max)) console.log(`   tsc @${d[1]}+${d[2]} TS${d[0]} ${d[3]}`); if (!t.length) console.log("   tsc parses"); }
}
console.error("inputs", inputs.length, "first diagnostic differs between tsc and go:", differ);
