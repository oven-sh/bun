// Parses each listed file with tsc's parser under its own name and writes its parse diagnostics.
// usage: node corpus-tsc.cjs <list file> <out jsonl>
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const [listFile, outFile] = process.argv.slice(2);
const out = fs.openSync(outFile, "w");
for (const file of fs.readFileSync(listFile, "utf8").split("\n").filter(Boolean)) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { continue; }
  let rec;
  try {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
    rec = { file, variant: sf.languageVariant, parse: sf.parseDiagnostics.slice(0, 3).map(d => ({ code: d.code, start: d.start, text: ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, 120), src: text.slice(Math.max(0, d.start - 40), d.start + 40) })), n: sf.parseDiagnostics.length };
  } catch (e) {
    rec = { file, crash: String(e && e.message).slice(0, 200) };
  }
  fs.writeSync(out, JSON.stringify(rec) + "\n");
}
fs.closeSync(out);
