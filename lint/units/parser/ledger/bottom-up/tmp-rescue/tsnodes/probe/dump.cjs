const ts = require("/workspace/wt/parser/node_modules/typescript");
const src = process.argv[2];
const sf = ts.createSourceFile("a.ts", src, ts.ScriptTarget.Latest, true);
function show(n, depth) {
  const kind = ts.SyntaxKind[n.kind];
  const start = n.getStart(sf);
  let extra = "";
  for (const k of Object.keys(n)) {
    const v = n[k];
    if (v && typeof v === "object" && Array.isArray(v) && v.pos !== undefined) {
      extra += ` ${k}[${v.length}]@${v.pos}-${v.end}${v.hasTrailingComma ? " trailingComma" : ""}`;
    }
  }
  console.log(`${"  ".repeat(depth)}${kind} pos=${n.pos} start=${start} end=${n.end}${extra} ${JSON.stringify(src.slice(start, n.end)).slice(0, 50)}`);
  ts.forEachChild(n, c => show(c, depth + 1));
}
console.log(JSON.stringify(src), "version", ts.version);
show(sf, 0);
if (sf.parseDiagnostics.length) console.log("parseDiagnostics:", sf.parseDiagnostics.map(d => `TS${d.code}@${d.start}+${d.length} ${typeof d.messageText === "string" ? d.messageText : d.messageText.messageText}`));
