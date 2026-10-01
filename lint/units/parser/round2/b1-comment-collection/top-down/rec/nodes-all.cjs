// node nodes-all.cjs cases.json  ->  per input: parse diagnostics, and every node that is no token with pos (full start), start, end in bytes; lists too.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const K = ts.SyntaxKind;
const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
for (const [file, text] of inputs) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, kind);
  const b = i => Buffer.byteLength(text.slice(0, i), "utf8");
  const diags = sf.parseDiagnostics.map(d => `TS${d.code}@${b(d.start)}+${d.length} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  console.log(`== ${file}  ${JSON.stringify(text)}${diags.length ? "\n   PARSE-DIAGS " + diags.join(" | ") : ""}`);
  (function visit(n, depth) {
    const isToken = n.kind >= K.FirstToken && n.kind <= K.LastToken && !(n.kind >= K.FirstKeyword && n.kind <= K.LastKeyword);
    if (n.kind !== K.SourceFile && !isToken && n.kind !== K.Identifier && n.kind !== K.EndOfFileToken) {
      let extra = "";
      for (const key of ["modifiers", "typeArguments", "typeParameters", "parameters", "members", "types"]) {
        if (n[key] && n[key].pos !== undefined) extra += ` ${key}<${b(n[key].pos)},${b(n[key].end)}>`;
      }
      console.log(`   ${"  ".repeat(Math.min(depth, 7))}${K[n.kind]} pos=${b(n.pos)} start=${b(n.getStart(sf))} end=${b(n.end)}${extra}`);
    }
    if (n.kind === K.QuestionToken || n.kind === K.ExclamationToken) console.log(`   ${"  ".repeat(Math.min(depth, 7))}${K[n.kind]} start=${b(n.getStart(sf))} end=${b(n.end)}`);
    ts.forEachChild(n, c => visit(c, depth + 1));
  })(sf, 0);
}
