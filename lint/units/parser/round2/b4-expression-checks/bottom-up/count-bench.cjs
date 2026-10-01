// Counts, per cgbench group, how often the valid-path placements of the prototype run in one pass over the inputs of the benchmark
// (/workspace/notes/lint/benchroot, tsc 6.0.2 as the reader): a name spelled `await` (the `**` test after it), a statement or a `for`
// head that starts with the word `using` followed by a name (the `opts.is_for_loop_init` test), `?.` before `(` after `new` (the hooks),
// and the constructs whose handlers only changed on their error paths.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const path = require("path");
const root = "/workspace/notes/lint/benchroot";
const walkDir = (dir, out, filter) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walkDir(p, out, filter);
    } else if (filter(p)) out.push(p);
  }
  return out;
};
const groups = [
  ["bun-types", ts.ScriptKind.TS, () => walkDir(path.join(root, "packages/bun-types"), [], p => p.endsWith(".d.ts") && !p.includes("/ts7.1/")), 1],
  ["typescript-lib", ts.ScriptKind.TS, () => fs.readdirSync(path.join(root, "node_modules/typescript/lib")).filter(n => /^lib.*\.d\.ts$/.test(n)).map(n => path.join(root, "node_modules/typescript/lib", n)), 1],
  ["src-js", ts.ScriptKind.TS, () => walkDir(path.join(root, "src/js"), [], p => p.endsWith(".ts")), 1],
  ["tsx", ts.ScriptKind.TSX, () => [path.join(root, "bench/snippets/transpiler-typescript-fixture.tsx")], 100],
  ["js-control", ts.ScriptKind.JS, () => [path.join(root, "bench/react-hello-world/react-hello-world.node.js")], 1],
];
const SK = ts.SyntaxKind;
for (const [name, kind, files, repeat] of groups) {
  const c = { files: 0, awaitName: 0, usingWordThenName: 0, usingDeclaration: 0, newExpr: 0, optionalAfterNew: 0, superKeyword: 0, prefixUnaryOrAwait: 0, elementAccess: 0, privateNameAccess: 0, privateNameInOptionalChain: 0, instantiationExpr: 0, typeAssertion: 0, pow: 0, parseDiagnostics: 0 };
  for (const file of files().sort()) {
    c.files++;
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, kind);
    c.parseDiagnostics += sf.parseDiagnostics.length;
    const visit = n => {
      switch (n.kind) {
        case SK.Identifier:
          if (n.escapedText === "await") c.awaitName++;
          if (n.escapedText === "using") {
            const after = ts.createScanner(ts.ScriptTarget.ESNext, true, ts.LanguageVariant.Standard, text, undefined, n.end);
            const tok = after.scan();
            if (tok === SK.Identifier || (tok >= SK.FirstKeyword && tok <= SK.LastKeyword)) c.usingWordThenName++;
          }
          break;
        case SK.VariableDeclarationList:
          if ((n.flags & ts.NodeFlags.Using) !== 0) c.usingDeclaration++;
          break;
        case SK.NewExpression:
          c.newExpr++;
          break;
        case SK.SuperKeyword:
          c.superKeyword++;
          break;
        case SK.PrefixUnaryExpression:
          if (n.operator !== SK.PlusPlusToken && n.operator !== SK.MinusMinusToken) c.prefixUnaryOrAwait++;
          break;
        case SK.DeleteExpression:
        case SK.TypeOfExpression:
        case SK.VoidExpression:
        case SK.AwaitExpression:
          c.prefixUnaryOrAwait++;
          break;
        case SK.ElementAccessExpression:
          c.elementAccess++;
          break;
        case SK.PropertyAccessExpression:
          if (n.name.kind === SK.PrivateIdentifier) {
            c.privateNameAccess++;
            if (n.flags & ts.NodeFlags.OptionalChain) c.privateNameInOptionalChain++;
          }
          if (n.questionDotToken && n.expression.kind === SK.NewExpression && !n.expression.arguments) c.optionalAfterNew++;
          break;
        case SK.ExpressionWithTypeArguments:
          if (n.parent.kind !== SK.HeritageClause) c.instantiationExpr++;
          break;
        case SK.TypeAssertionExpression:
          c.typeAssertion++;
          break;
        case SK.BinaryExpression:
          if (n.operatorToken.kind === SK.AsteriskAsteriskToken) c.pow++;
          break;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  console.log(name.padEnd(15), `passes per run of cgbench: ${20 * repeat}`.padEnd(34), JSON.stringify(c));
}
