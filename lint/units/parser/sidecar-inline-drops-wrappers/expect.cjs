// Prints, from the tsc tree, the records that a lint parse has to make for an input:
// wrappers in order of creation, parentheses, modifiers with the start of the name they belong to,
// `?` and `!` marks, and type-only import and export specifiers. Offsets are bytes for ASCII inputs.
// usage: node expect.cjs inputs/chains.json ...   or   node expect.cjs --src 'a as T'
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const K = ts.SyntaxKind;
const WRAP = new Set([K.AsExpression, K.SatisfiesExpression, K.NonNullExpression, K.TypeAssertionExpression]);
const name = k => K[k].replace("FirstContextualKeyword", "AbstractKeyword");
function expect(src, file) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const erase = n => { while (n.kind === K.ParenthesizedExpression || WRAP.has(n.kind)) n = n.expression; return n; };
  const r = n => "[" + n.getStart(sf) + "," + n.end + ")";
  const owner = n => {
    const nm = n.name || (n.kind === K.Constructor ? n : null) || (n.kind === K.IndexSignature ? n : null) || n;
    return name(n.kind) + "@" + (n.name ? n.name.getStart(sf) : n.getStart(sf));
  };
  (function walk(n) {
    ts.forEachChild(n, walk);
    if (WRAP.has(n.kind)) {
      const e = erase(n.expression);
      const kind = name(n.kind).replace("Expression", "");
      let op;
      if (n.kind === K.NonNullExpression) op = n.end - 1;
      else if (n.kind === K.TypeAssertionExpression) op = n.getStart(sf);
      else op = n.type.pos - (n.kind === K.AsExpression ? 2 : 9);
      out.push(`wrapper ${kind} operand=${name(e.kind)}${r(e)} op=${op}` + (n.type ? ` type=${r(n.type)}` : "") + ` end=${n.end}`);
    }
    if (n.kind === K.ParenthesizedExpression) out.push(`paren open=${n.getStart(sf)} close=${n.end - 1} inner=${name(n.expression.kind)}${r(n.expression)}`);
    if (n.modifiers) for (const m of n.modifiers) if (m.kind !== K.Decorator) out.push(`modifier ${name(m.kind)} ${r(m)} owner=${owner(n)}`);
    if (n.questionToken && n.kind !== K.ConditionalExpression && !ts.isTypeNode(n) && n.kind !== K.PropertySignature && n.kind !== K.MethodSignature) out.push(`mark Optional ${r(n.questionToken)} owner=${owner(n)}`);
    if (n.exclamationToken) out.push(`mark Definite ${r(n.exclamationToken)} owner=${owner(n)}`);
    if ((n.kind === K.ImportSpecifier || n.kind === K.ExportSpecifier) && n.isTypeOnly)
      out.push(`specifier ${n.kind === K.ImportSpecifier ? "import" : "export"} ${r(n)} type=[${n.getStart(sf)},${n.getStart(sf) + 4})` + (n.propertyName ? ` property=${r(n.propertyName)}` : "") + ` name=${r(n.name)}`);
  })(sf);
  for (const d of sf.parseDiagnostics) out.push(`diagnostic TS${d.code} [${d.start},${d.start + d.length}) ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  return out;
}
const args = process.argv.slice(2);
const inputs = args[0] === "--src" ? args.slice(1) : args.flatMap(f => JSON.parse(require("fs").readFileSync(f, "utf8")));
for (const item of inputs) {
  const [file, src] = Array.isArray(item) ? item : ["t.ts", item];
  console.log("=== " + file + " " + JSON.stringify(src));
  for (const l of expect(src, file)) console.log("  " + l);
}
