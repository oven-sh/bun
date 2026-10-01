const ts = require("/workspace/wt/parser/node_modules/typescript");
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
const cases = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
for (const [loader, code] of cases) {
  const sf = ts.createSourceFile("x." + loader, code, ts.ScriptTarget.Latest, true, kinds[loader]);
  const b = i => Buffer.byteLength(code.slice(0, i), "utf8");
  const d = sf.parseDiagnostics.map(d => `TS${d.code}[${b(d.start)},${b(d.start + d.length)}) ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  console.log(JSON.stringify(code), "[" + loader + "]", "=>", d.join(" | ") || "no parse diagnostics");
}
console.log(ts.version);
