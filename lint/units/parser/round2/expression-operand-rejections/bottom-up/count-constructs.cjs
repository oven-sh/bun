// Counts, per cgbench group, the expression constructs whose Bun handlers a site test would sit on.
const ts = require("/workspace/bun/node_modules/typescript");
const fs = require("node:fs");
const path = require("node:path");
const root = "/workspace/notes/lint/benchroot";
function walkDir(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(p, out); else out.push(p);
  }
  return out;
}
const groups = [
  { name: "bun-types", kind: ts.ScriptKind.TS, files: () => walkDir(root + "/packages/bun-types", []).filter(p => p.endsWith(".d.ts") && !p.includes("/node_modules/") && !p.includes("/ts7.1/")), repeat: 1 },
  { name: "typescript-lib", kind: ts.ScriptKind.TS, files: () => fs.readdirSync(root + "/node_modules/typescript/lib").filter(n => /^lib.*\.d\.ts$/.test(n)).map(n => root + "/node_modules/typescript/lib/" + n), repeat: 1 },
  { name: "src-js", kind: ts.ScriptKind.TS, files: () => walkDir(root + "/src/js", []).filter(p => p.endsWith(".ts") && !p.includes("/node_modules/")), repeat: 1 },
  { name: "tsx", kind: ts.ScriptKind.TSX, files: () => [root + "/bench/snippets/transpiler-typescript-fixture.tsx"], repeat: 100 },
  { name: "js-control", kind: ts.ScriptKind.JS, files: () => [root + "/bench/react-hello-world/react-hello-world.node.js"], repeat: 1 },
];
const K = ts.SyntaxKind;
const isAssign = k => k >= K.FirstAssignment && k <= K.LastAssignment;
for (const g of groups) {
  const c = { files: 0, bytes: 0, parseErrors: 0, postfix: 0, prefixUpdate: 0, assignEq: 0, assignCompound: 0, assignLeftNew: 0, newExpr: 0, propAccess: 0, propAccessOptional: 0, propAccessPrivate: 0, propAccessNewlineAfterDot: 0, elemAccess: 0, yieldBare: 0, yieldStar: 0, yieldAll: 0, superKw: 0, usingFor: 0, usingStmt: 0, typeAssertion: 0, exprWithTypeArgs: 0, callTypeArgs: 0, prefixUnary: 0, awaitExpr: 0, binaryPow: 0, taggedTemplate: 0, nonNull: 0 };
  for (const f of g.files()) {
    const text = fs.readFileSync(f, "utf8");
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, false, g.kind);
    c.files++; c.bytes += Buffer.byteLength(text); c.parseErrors += sf.parseDiagnostics.length;
    const visit = n => {
      switch (n.kind) {
        case K.PostfixUnaryExpression: c.postfix++; break;
        case K.PrefixUnaryExpression: if (n.operator === K.PlusPlusToken || n.operator === K.MinusMinusToken) c.prefixUpdate++; else c.prefixUnary++; break;
        case K.BinaryExpression:
          if (n.operatorToken.kind === K.EqualsToken) { c.assignEq++; if (n.left.kind === K.NewExpression) c.assignLeftNew++; }
          else if (isAssign(n.operatorToken.kind)) c.assignCompound++;
          else if (n.operatorToken.kind === K.AsteriskAsteriskToken) c.binaryPow++;
          break;
        case K.NewExpression: c.newExpr++; break;
        case K.PropertyAccessExpression:
          c.propAccess++;
          if (n.questionDotToken) c.propAccessOptional++;
          if (n.name.kind === K.PrivateIdentifier) c.propAccessPrivate++;
          { const dotEnd = n.name.pos; const nameStart = n.name.getStart(sf); if (/[\r\n]/.test(text.slice(dotEnd, nameStart))) c.propAccessNewlineAfterDot++; }
          break;
        case K.ElementAccessExpression: c.elemAccess++; break;
        case K.YieldExpression: c.yieldAll++; if (n.asteriskToken) c.yieldStar++; if (!n.expression) c.yieldBare++; break;
        case K.SuperKeyword: c.superKw++; break;
        case K.VariableDeclarationList:
          if ((n.flags & ts.NodeFlags.Using) || (n.flags & ts.NodeFlags.AwaitUsing) === ts.NodeFlags.AwaitUsing) { if (n.parent === undefined) {} c.usingStmt++; }
          break;
        case K.TypeAssertionExpression: c.typeAssertion++; break;
        case K.ExpressionWithTypeArguments: if (n.parent?.kind !== K.HeritageClause) c.exprWithTypeArgs++; break;
        case K.CallExpression: if (n.typeArguments) c.callTypeArgs++; break;
        case K.AwaitExpression: c.awaitExpr++; break;
        case K.TaggedTemplateExpression: c.taggedTemplate++; break;
        case K.NonNullExpression: c.nonNull++; break;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  console.log(g.name, "repeat/pass=" + g.repeat, JSON.stringify(c));
}
