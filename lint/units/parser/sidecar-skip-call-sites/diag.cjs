const ts = require("/workspace/wt/parser/node_modules/typescript");
const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
for (const [text, file] of inputs) {
  const sf = ts.createSourceFile(file || "a.ts", text, ts.ScriptTarget.Latest, true);
  const d = sf.parseDiagnostics.map(d => `TS${d.code}@${d.start}+${d.length} ${JSON.stringify(ts.flattenDiagnosticMessageText(d.messageText, " "))}`);
  console.log(JSON.stringify(text).padEnd(52), d.length ? d.join(" | ") : "(no parse diagnostic)");
}
