// The first parse diagnostic of tsc for every file of the list (one path per line, relative to the root).
// usage: <bun or node> tsc-diags.cjs <root> <list.txt> <typescript package>
const fs = require("node:fs");
const [root, list, tsPath] = process.argv.slice(2);
const ts = require(tsPath);
const files = fs.readFileSync(list, "utf8").split("\n").filter(Boolean);
let withDiagnostics = 0;
for (const file of files) {
  const text = fs.readFileSync(root + "/" + file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, text, { languageVersion: ts.ScriptTarget.ESNext }, false, kind);
  const diagnostics = sourceFile.parseDiagnostics;
  if (!diagnostics.length) continue;
  withDiagnostics++;
  const first = diagnostics[0];
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(first.start);
  console.log(`TS${first.code} ${file}:${line + 1}:${character + 1} (${diagnostics.length}) ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`);
}
console.log(JSON.stringify({ typescript: ts.version, files: files.length, withDiagnostics }));
