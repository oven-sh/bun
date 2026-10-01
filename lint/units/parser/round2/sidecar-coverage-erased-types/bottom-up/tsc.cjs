// usage: node tsc.cjs inputs.json [ext=ts]   prints the first parse diagnostic of tsc 6.0.2 for each input, and the count
const ts = require("/workspace/bun/node_modules/typescript");
const fs = require("fs");
const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const ext = process.argv[3] || "ts";
inputs.forEach((src, i) => {
  const sf = ts.createSourceFile("a." + ext, src, ts.ScriptTarget.Latest, true);
  const d = sf.parseDiagnostics;
  const first = d[0];
  const line = first ? `TS${first.code} [${first.start},+${first.length}) ${ts.flattenDiagnosticMessageText(first.messageText, " ")} (n=${d.length})` : "ok";
  console.log(`${i}\t${JSON.stringify(src)}\t${line}`);
});
