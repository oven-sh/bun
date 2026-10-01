// Prints the parse diagnostics of tsc 6.0.2 for each input: code, start, length, text.
const ts = require("/workspace/bun/node_modules/typescript");
const fs = require("fs");
const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const entry of inputs) {
  const [name, text] = typeof entry === "string" ? ["a.ts", entry] : entry;
  const kind = name.endsWith(".tsx") ? ts.ScriptKind.TSX : name.endsWith(".js") ? ts.ScriptKind.JS : name.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, kind);
  const diags = sf.parseDiagnostics.map(d => `TS${d.code}@${d.start}+${d.length} ${JSON.stringify(ts.flattenDiagnosticMessageText(d.messageText, "\n"))}`);
  console.log(`${name}\t${JSON.stringify(text)}\n    ${diags.length ? diags.slice(0, 4).join("\n    ") : "(parses)"}`);
}
