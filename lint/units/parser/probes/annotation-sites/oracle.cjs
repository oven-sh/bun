// Prints, per input, the lines that annotation_tests.rs expects: annotations by key, then `this` parameters, then return types (functions before arrow functions).
const ts = require("/workspace/wt/parser/node_modules/typescript");
const K = ts.SyntaxKind;
const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
for (const { name, file, text } of inputs) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const ann = [], thisp = [], ret = [];
  const kind = n => (K[n.kind] === "FirstTypeNode" ? "TypePredicate" : K[n.kind] === "LastTypeNode" ? "ImportType" : K[n.kind]);
  const ty = n => `${kind(n)}[${n.getStart(sf)},${n.end})`;
  const isFn = n => [K.ArrowFunction, K.FunctionDeclaration, K.FunctionExpression, K.MethodDeclaration, K.Constructor, K.GetAccessor, K.SetAccessor].includes(n.kind);
  const isTypeSide = n => (ts.isTypeNode(n) && n.kind !== K.ExpressionWithTypeArguments) || (ts.isTypeElement(n) && !ts.isClassElement(n)) || n.kind === K.TypeAliasDeclaration || n.kind === K.InterfaceDeclaration;
  (function walk(n, inType) {
    const k = n.kind;
    if (!inType) {
      if ((k === K.VariableDeclaration || k === K.Parameter) && n.parent.kind !== K.IndexSignature) {
        const isThis = k === K.Parameter && n.name.kind === K.Identifier && n.name.escapedText === "this";
        if (isThis) {
          const before = n.parent.parameters.slice(0, n.parent.parameters.indexOf(n)).filter(p => !(p.name.kind === K.Identifier && p.name.escapedText === "this")).length;
          thisp.push([n.parent.parameters.pos - 1, n.name.getStart(sf), `this fn=${n.parent.parameters.pos - 1} index=${before} [${n.name.getStart(sf)},${n.name.end})${n.type ? " " + ty(n.type) : ""}`]);
        } else if (n.type) ann.push([n.name.getStart(sf), `type key=${n.name.getStart(sf)} ${ty(n.type)}`]);
      }
      if (k === K.PropertyDeclaration && n.type) {
        const key = n.name.kind === K.ComputedPropertyName ? n.name.expression.getStart(sf) : n.name.getStart(sf);
        ann.push([key, `type key=${key} ${ty(n.type)}`]);
      }
      if (isFn(n) && n.type) {
        if (n.kind === K.ArrowFunction) ret.push([1, n.getStart(sf), `return arrow=${n.getStart(sf)} ${ty(n.type)}`]);
        else ret.push([0, n.parameters.pos - 1, `return fn=${n.parameters.pos - 1} ${ty(n.type)}`]);
      }
    }
    ts.forEachChild(n, c => walk(c, inType || isTypeSide(n)));
  })(sf, false);
  ann.sort((a, b) => a[0] - b[0]);
  thisp.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  ret.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  console.log(`== ${name}  ${JSON.stringify(text)}`);
  for (const d of sf.parseDiagnostics) console.log(`   diag TS${d.code} at ${d.start}+${d.length}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  for (const l of [...ann.map(a => a[1]), ...thisp.map(a => a[2]), ...ret.map(a => a[2])]) console.log(`            "${l}",`);
}
