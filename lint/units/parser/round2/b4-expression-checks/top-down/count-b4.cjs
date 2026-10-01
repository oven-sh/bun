// Counts, per cgbench group, the constructs that reach a site which the B4 plan edits on a path that a valid program takes.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const path = require("path");
const root = "/workspace/notes/lint/benchroot";
function walkDir(dir, out, filter) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === "node_modules") continue; walkDir(p, out, filter); }
    else if (filter(p)) out.push(p);
  }
}
const groups = [
  { name: "bun-types", kind: ts.ScriptKind.TS, parses: 20, files: () => { const o = []; walkDir(path.join(root, "packages/bun-types"), o, p => p.endsWith(".d.ts") && !p.includes("/ts7.1/")); return o; } },
  { name: "typescript-lib", kind: ts.ScriptKind.TS, parses: 20, files: () => fs.readdirSync(path.join(root, "node_modules/typescript/lib")).filter(n => /^lib.*\.d\.ts$/.test(n)).map(n => path.join(root, "node_modules/typescript/lib", n)) },
  { name: "src-js", kind: ts.ScriptKind.TS, parses: 20, files: () => { const o = []; walkDir(path.join(root, "src/js"), o, p => p.endsWith(".ts")); return o; } },
  { name: "tsx", kind: ts.ScriptKind.TSX, parses: 2000, files: () => [path.join(root, "bench/snippets/transpiler-typescript-fixture.tsx")] },
  { name: "js-control", kind: ts.ScriptKind.JS, parses: 20, files: () => [path.join(root, "bench/react-hello-world/react-hello-world.node.js")] },
];
const SK = ts.SyntaxKind;
const isChain = n => !!(n.flags & ts.NodeFlags.OptionalChain);
for (const g of groups) {
  const c = { files: 0, parseDiagnostics: 0, newExpr: 0, newWithoutArgs: 0, questionDot: 0, questionDotName: 0, questionDotBracket: 0, questionDotCall: 0, questionDotPrivateName: 0, privateNameAccess: 0, privateNameAccessInChain: 0, elementAccess: 0, superKeyword: 0, prefixUnaryNotUpdate: 0, awaitExpr: 0, typeofVoidDelete: 0, pow: 0, typeAssertion: 0, exprWithTypeArgsOutsideHeritage: 0, usingDeclaration: 0, identifierNamedUsing: 0, forHeadStartingWithUsing: 0 };
  for (const f of g.files().sort()) {
    const text = fs.readFileSync(f, "utf8");
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, g.kind);
    c.files++;
    c.parseDiagnostics += sf.parseDiagnostics.length;
    const visit = n => {
      switch (n.kind) {
        case SK.NewExpression: c.newExpr++; if (!n.arguments) c.newWithoutArgs++; break;
        case SK.PropertyAccessExpression:
          if (n.questionDotToken) { c.questionDot++; c.questionDotName++; if (n.name.kind === SK.PrivateIdentifier) c.questionDotPrivateName++; }
          if (n.name.kind === SK.PrivateIdentifier) { c.privateNameAccess++; if (isChain(n)) c.privateNameAccessInChain++; }
          break;
        case SK.ElementAccessExpression: c.elementAccess++; if (n.questionDotToken) { c.questionDot++; c.questionDotBracket++; } break;
        case SK.CallExpression: if (n.questionDotToken) { c.questionDot++; c.questionDotCall++; } break;
        case SK.SuperKeyword: c.superKeyword++; break;
        case SK.PrefixUnaryExpression: if (n.operator !== SK.PlusPlusToken && n.operator !== SK.MinusMinusToken) c.prefixUnaryNotUpdate++; break;
        case SK.AwaitExpression: c.awaitExpr++; break;
        case SK.TypeOfExpression: case SK.VoidExpression: case SK.DeleteExpression: c.typeofVoidDelete++; break;
        case SK.BinaryExpression: if (n.operatorToken.kind === SK.AsteriskAsteriskToken) c.pow++; break;
        case SK.TypeAssertionExpression: c.typeAssertion++; break;
        case SK.ExpressionWithTypeArguments: if (n.parent.kind !== SK.HeritageClause) c.exprWithTypeArgsOutsideHeritage++; break;
        case SK.VariableDeclarationList: if ((n.flags & ts.NodeFlags.BlockScoped) === ts.NodeFlags.Using || (n.flags & ts.NodeFlags.BlockScoped) === ts.NodeFlags.AwaitUsing) c.usingDeclaration++; break;
        case SK.Identifier: if (n.escapedText === "using") c.identifierNamedUsing++; break;
        case SK.ForStatement: case SK.ForInStatement: case SK.ForOfStatement: if (n.initializer && sf.text.slice(n.initializer.getStart(sf), n.initializer.getStart(sf) + 5) === "using") c.forHeadStartingWithUsing++; break;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  console.log(JSON.stringify({ group: g.name, parsesPerRun: g.parses, perParse: c }));
}
