// usage: node tsc.cjs <file with one JSON string per line, optional prefix js:/tsx:/jsx:>
const ts = require("/workspace/bun/node_modules/typescript");
const fs = require("node:fs");
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
const lines = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(l => l && !l.startsWith("#"));
for (const line of lines) {
  let loader = "ts", rest = line;
  const m = /^(ts|tsx|js|jsx):(.*)$/s.exec(line);
  if (m) { loader = m[1]; rest = m[2]; }
  const code = JSON.parse(rest);
  const sf = ts.createSourceFile("x." + loader, code, ts.ScriptTarget.Latest, false, kinds[loader]);
  console.log(JSON.stringify(code), "[" + loader + "]");
  for (const d of sf.parseDiagnostics.slice(0, 4)) console.log(`   tsc @${d.start}+${d.length} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}   <<${code.slice(d.start, d.start + d.length)}>>`);
  if (!sf.parseDiagnostics.length) console.log("   tsc parses");
}
