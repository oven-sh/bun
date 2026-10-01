// Counts, per cgbench group, the nodes of tsc's tree that correspond to the Bun handlers a site test would sit in.
const ts = require("/workspace/bun/node_modules/typescript");
const fs = require("fs");
const path = require("path");
const root = "/workspace/notes/lint/benchroot";

function walkDir(dir, out, filter) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walkDir(p, out, filter);
    } else if (filter(p)) out.push(p);
  }
}

const groups = [
  { name: "bun-types", kind: ts.ScriptKind.TS, files: () => { const o = []; walkDir(path.join(root, "packages/bun-types"), o, p => p.endsWith(".d.ts") && !p.includes("/ts7.1/")); return o; }, repeat: 1 },
  { name: "typescript-lib", kind: ts.ScriptKind.TS, files: () => fs.readdirSync(path.join(root, "node_modules/typescript/lib")).filter(n => /^lib.*\.d\.ts$/.test(n)).map(n => path.join(root, "node_modules/typescript/lib", n)), repeat: 1 },
  { name: "src-js", kind: ts.ScriptKind.TS, files: () => { const o = []; walkDir(path.join(root, "src/js"), o, p => p.endsWith(".ts")); return o; }, repeat: 1 },
  { name: "tsx", kind: ts.ScriptKind.TSX, files: () => [path.join(root, "bench/snippets/transpiler-typescript-fixture.tsx")], repeat: 100 },
  { name: "js-control", kind: ts.ScriptKind.JS, files: () => [path.join(root, "bench/react-hello-world/react-hello-world.node.js")], repeat: 1 },
];

const SK = ts.SyntaxKind;
function isAssignOp(k) { return k >= SK.FirstAssignment && k <= SK.LastAssignment; }

for (const g of groups) {
  const files = g.files().sort();
  const c = { files: files.length, bytes: 0, assign: 0, postfix: 0, prefixUpdate: 0, prefixUnary: 0, del: 0, typeOf: 0, voidE: 0, awaitE: 0, newE: 0, yieldE: 0, superK: 0, elemAccess: 0, propAccess: 0, call: 0, pow: 0, typeAssertion: 0, asExpr: 0, nonNull: 0, paren: 0, binary: 0, exprWithTypeArgs: 0, forStmt: 0, usingWord: 0, optionalDot: 0, tokens: 0 };
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    c.bytes += Buffer.byteLength(text);
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, false, g.kind);
    const visit = n => {
      switch (n.kind) {
        case SK.BinaryExpression:
          c.binary++;
          if (isAssignOp(n.operatorToken.kind)) c.assign++;
          if (n.operatorToken.kind === SK.AsteriskAsteriskToken) c.pow++;
          break;
        case SK.PostfixUnaryExpression: c.postfix++; break;
        case SK.PrefixUnaryExpression:
          if (n.operator === SK.PlusPlusToken || n.operator === SK.MinusMinusToken) c.prefixUpdate++; else c.prefixUnary++;
          break;
        case SK.DeleteExpression: c.del++; break;
        case SK.TypeOfExpression: c.typeOf++; break;
        case SK.VoidExpression: c.voidE++; break;
        case SK.AwaitExpression: c.awaitE++; break;
        case SK.NewExpression: c.newE++; break;
        case SK.YieldExpression: c.yieldE++; break;
        case SK.SuperKeyword: c.superK++; break;
        case SK.ElementAccessExpression: c.elemAccess++; if (n.questionDotToken) c.optionalDot++; break;
        case SK.PropertyAccessExpression: c.propAccess++; if (n.questionDotToken) c.optionalDot++; break;
        case SK.CallExpression: c.call++; if (n.questionDotToken) c.optionalDot++; break;
        case SK.TypeAssertionExpression: c.typeAssertion++; break;
        case SK.AsExpression: case SK.SatisfiesExpression: c.asExpr++; break;
        case SK.NonNullExpression: c.nonNull++; break;
        case SK.ParenthesizedExpression: c.paren++; break;
        case SK.ExpressionWithTypeArguments: if (n.parent && n.parent.kind !== SK.HeritageClause) c.exprWithTypeArgs++; break;
        case SK.ForStatement: case SK.ForInStatement: case SK.ForOfStatement: c.forStmt++; break;
        case SK.Identifier: if (n.escapedText === "using") c.usingWord++; break;
      }
      ts.forEachChild(n, visit);
    };
    sf.parent = undefined;
    ts.forEachChild(sf, function setParents(n) { /* parents */ });
    const sf2 = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, g.kind);
    ts.forEachChild(sf2, visit);
  }
  const per = {};
  for (const k of Object.keys(c)) per[k] = c[k];
  const runs = 20 * g.repeat;
  console.log(JSON.stringify({ group: g.name, parsesPerRun: runs, perParse: per, x20: { assign: c.assign * runs, postfix: c.postfix * runs, prefixUpdate: c.prefixUpdate * runs, prefixUnaryAll: (c.prefixUnary + c.del + c.typeOf + c.voidE + c.awaitE) * runs, newE: c.newE * runs, superK: c.superK * runs, elemAccess: c.elemAccess * runs, propAccess: c.propAccess * runs, call: c.call * runs, yieldE: c.yieldE * runs, forStmt: c.forStmt * runs } }));
}
