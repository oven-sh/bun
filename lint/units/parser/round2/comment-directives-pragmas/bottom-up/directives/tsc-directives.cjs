// node tsc-directives.cjs <inputs.json>: commentDirectives of TypeScript 6.0.2 per input, duplicates of its lookahead dropped, UTF-8 byte offsets.
const ts = require(process.env.ORACLE_TYPESCRIPT || "/workspace/bun/node_modules/typescript");
const fs = require("fs");
const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const ext = process.argv[3] || "ts";
for (const [name, source, e] of inputs) {
  const x = e || ext;
  const kind = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX }[x];
  const sf = ts.createSourceFile("x." + x, source, ts.ScriptTarget.Latest, false, kind);
  const b = i => Buffer.byteLength(source.slice(0, i), "utf8");
  const seen = new Set(); const ds = [];
  for (const d of sf.commentDirectives || []) {
    const s = `${d.type === ts.CommentDirectiveType.ExpectError ? "ExpectError" : "Ignore"} ${b(d.range.pos)}..${b(d.range.end)}`;
    if (!seen.has(s)) { seen.add(s); ds.push(s); }
  }
  console.log(`--- ${name} ${JSON.stringify(source)}${sf.parseDiagnostics.length ? " PARSE-ERRORS=" + sf.parseDiagnostics.map(d => "TS" + d.code).join(",") : ""}\n  directives=[${ds.join(", ")}]${(sf.commentDirectives || []).length !== ds.length ? " (tsc lists " + sf.commentDirectives.length + " with duplicates)" : ""}`);
}
