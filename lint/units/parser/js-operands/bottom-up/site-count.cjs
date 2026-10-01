// usage: node site-count.cjs <typescript.js> <benchroot> : per benchmark group and per pass, how often the parser reaches
// the sites that the JavaScript-file switch touches (one type-argument attempt per `<` or `<<` after an expression).
const ts = require(process.argv[2]);
const fs = require("fs"), path = require("path");
const root = process.argv[3];
const groups = [
  { name: "bun-types", dir: "packages/bun-types", re: /\.d\.ts$/, skip: ["ts7.1/"], kind: ts.ScriptKind.TS },
  { name: "typescript-lib", dir: "node_modules/typescript/lib", re: /^lib.*\.d\.ts$/, flat: true, kind: ts.ScriptKind.TS },
  { name: "src-js", dir: "src/js", re: /\.ts$/, kind: ts.ScriptKind.TS },
  { name: "tsx", dir: "bench/snippets", re: /^transpiler-typescript-fixture\.tsx$/, flat: true, repeat: 100, kind: ts.ScriptKind.TSX },
  { name: "js-control", dir: "bench/react-hello-world", re: /^react-hello-world\.node\.js$/, flat: true, kind: ts.ScriptKind.JS },
];
function walkDir(d, rel, out, g) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) { if (g.flat || e.name === "node_modules" || (g.skip ?? []).some(s => (r + "/").startsWith(s) || (r + "/").includes("/" + s))) continue; walkDir(path.join(d, e.name), r, out, g); }
    else if (g.re.test(g.flat ? e.name : r)) out.push(path.join(d, e.name));
  }
}
for (const g of groups) {
  const files = []; walkDir(path.join(root, g.dir), "", files, g);
  const c = { files: files.length, ltOperators: 0, typeArgumentLists: 0, newWithTypeArguments: 0, heritageWithTypeArguments: 0, jsxTags: 0, jsxTagsWithTypeArguments: 0, optionalCallTypeArguments: 0, decorators: 0, prefixOpenParen: 0, parseErrors: 0 };
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.ESNext, true, g.kind);
    c.parseErrors += sf.parseDiagnostics.length;
    const walk = n => {
      const K = ts.SyntaxKind;
      if (n.kind === K.BinaryExpression && (n.operatorToken.kind === K.LessThanToken || n.operatorToken.kind === K.LessThanLessThanToken)) c.ltOperators++;
      if ((n.kind === K.CallExpression || n.kind === K.TaggedTemplateExpression || (n.kind === K.ExpressionWithTypeArguments && n.parent.kind !== K.HeritageClause)) && n.typeArguments) { c.typeArgumentLists++; if (n.questionDotToken) c.optionalCallTypeArguments++; }
      if (n.kind === K.NewExpression && n.typeArguments) c.newWithTypeArguments++;
      if (n.kind === K.ExpressionWithTypeArguments && n.parent.kind === K.HeritageClause && n.parent.token === K.ExtendsKeyword && n.parent.parent.kind !== K.InterfaceDeclaration && n.typeArguments) c.heritageWithTypeArguments++;
      if (n.kind === K.JsxOpeningElement || n.kind === K.JsxSelfClosingElement) { c.jsxTags++; if (n.typeArguments) c.jsxTagsWithTypeArguments++; }
      if (n.kind === K.Decorator) c.decorators++;
      if (n.kind === K.ParenthesizedExpression) c.prefixOpenParen++;
      if (n.kind === K.ArrowFunction && n.getChildren(sf).some(x => x.kind === K.OpenParenToken) && !(n.modifiers ?? []).some(m => m.kind === K.AsyncKeyword)) c.prefixOpenParen++;
      ts.forEachChild(n, walk);
    };
    walk(sf);
  }
  const rep = g.repeat ?? 1;
  const attempts = c.ltOperators + c.typeArgumentLists + c.newWithTypeArguments + c.heritageWithTypeArguments;
  console.log(JSON.stringify({ group: g.name, ...c, repeat: rep, typeArgumentAttemptsPerPass: attempts * rep, jsxTagsPerPass: c.jsxTags * rep, prefixOpenParenPerPass: c.prefixOpenParen * rep }));
}
