// What TypeScript 6.0.2 reads from the header of each input: node tsc-header.cjs inputs.json [file name]
// Offsets are UTF-16 code units, as TypeScript counts them.
const ts = require(process.env.ORACLE_TYPESCRIPT || "/workspace/bun/node_modules/typescript");
const fs = require("fs");
const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const fileName = process.argv[3] || "a.ts";
const kinds = { [ts.SyntaxKind.SingleLineCommentTrivia]: "line", [ts.SyntaxKind.MultiLineCommentTrivia]: "block" };
const refs = (list, text) =>
  list
    .map(r => {
      let s = `${r.pos}..${r.end} ${JSON.stringify(r.fileName)}`;
      if (r.resolutionMode !== undefined) s += " mode=" + (r.resolutionMode === ts.ModuleKind.ESNext ? "import" : "require");
      if (r.preserve) s += " preserve";
      return s;
    })
    .join(", ");
for (const [name, text] of inputs) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false);
  console.log(`--- ${name} ${JSON.stringify(text)}`);
  const ps = [];
  for (const [pragmaName, entryOrList] of sf.pragmas) {
    for (const entry of Array.isArray(entryOrList) ? entryOrList : [entryOrList]) {
      const args = Object.entries(entry.arguments)
        .map(([k, v]) => (typeof v === "string" ? `${k}=${JSON.stringify(v)}` : `${k}=${v.pos}..${v.end} ${JSON.stringify(v.value)}`))
        .join("; ");
      ps.push(`${pragmaName} ${kinds[entry.range.kind]} ${entry.range.pos}..${entry.range.end} nl=${!!entry.range.hasTrailingNewLine} {${args}}`);
    }
  }
  console.log(`  pragmas=[${ps.join(" | ")}]`);
  console.log(`  referencedFiles=[${refs(sf.referencedFiles, text)}]`);
  console.log(`  typeReferenceDirectives=[${refs(sf.typeReferenceDirectives, text)}]`);
  console.log(`  libReferenceDirectives=[${refs(sf.libReferenceDirectives, text)}]`);
  const c = sf.checkJsDirective;
  console.log(c ? `  checkJsDirective=enabled:${c.enabled} ${c.pos}..${c.end}` : `  checkJsDirective=none`);
  if (sf.hasNoDefaultLib) console.log(`  hasNoDefaultLib=true`);
  const ds = sf.parseDiagnostics.map(d => `TS${d.code} ${d.start}..${d.start + d.length}`);
  console.log(`  diagnostics=[${ds.join(", ")}]`);
  const cd = (sf.commentDirectives || []).map(d => `${d.type === ts.CommentDirectiveType.ExpectError ? "ExpectError" : "Ignore"} ${d.range.pos}..${d.range.end}`);
  if (cd.length) console.log(`  commentDirectives=[${cd.join(", ")}]`);
}
