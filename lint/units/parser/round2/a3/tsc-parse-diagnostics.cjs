// The parse diagnostics of tsc for every TypeScript file that git tracks under test/ and src/js: what a strict parse may reject.
// usage: <bun or node> tsc-parse-diagnostics.cjs <repository root> [<path of the typescript package>]
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const root = process.argv[2];
const ts = require(process.argv[3] ?? "/workspace/bun/node_modules/typescript");
const listed = execFileSync("git", ["-C", root, "ls-files", "-z", "--", "test", "src/js"], { maxBuffer: 1 << 28 }).toString();
const files = listed.split("\0").filter(file => /\.(ts|tsx|mts|cts)$/.test(file));
let withDiagnostics = 0;
for (const file of files) {
  const text = fs.readFileSync(root + "/" + file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, text, { languageVersion: ts.ScriptTarget.ESNext }, false, kind);
  const [first] = sourceFile.parseDiagnostics;
  if (!first) continue;
  withDiagnostics++;
  console.log(`TS${first.code} ${file} @${first.start}+${first.length} ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`);
}
console.log(JSON.stringify({ typescript: ts.version, files: files.length, withDiagnostics }));
