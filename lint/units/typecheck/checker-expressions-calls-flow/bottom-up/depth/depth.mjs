// Measures nesting depths that drive checker recursion, with typescript's own parser.
// usage: bun depth.mjs <out.tsv> <file>...   (or a file list on stdin when no files are given)
import ts from "/workspace/wt/typecheck/node_modules/typescript/lib/typescript.js";
import fs from "node:fs";
const out = process.argv[2];
let files = process.argv.slice(3);
if (files.length === 0) files = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);
const rows = [];
for (const file of files) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".jsx") ? ts.ScriptKind.JSX : file.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  let sf;
  try { sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind); } catch (e) { rows.push([file, "PARSEFAIL"].join("\t")); continue; }
  // iterative walk: depth of any node, depth counted in expression nodes only, longest chain of directly nested binary expressions,
  // longest chain of nested call/property/element access (callee spine), statements in one statement list, nested blocks
  let maxDepth = 0, maxExprDepth = 0, maxBin = 0, maxAccess = 0, maxStmts = 0, maxParen = 0, maxCond = 0, maxIfElse = 0;
  const stack = [[sf, 0, 0, 0, 0, 0, 0, 0]];
  while (stack.length) {
    const [n, d, ed, bin, acc, par, cond, ie] = stack.pop();
    if (d > maxDepth) maxDepth = d;
    if (ed > maxExprDepth) maxExprDepth = ed;
    if (bin > maxBin) maxBin = bin;
    if (acc > maxAccess) maxAccess = acc;
    if (par > maxParen) maxParen = par;
    if (cond > maxCond) maxCond = cond;
    if (ie > maxIfElse) maxIfElse = ie;
    if (n.statements && n.statements.length > maxStmts) maxStmts = n.statements.length;
    const isExpr = n.kind >= ts.SyntaxKind.FirstLiteralToken && n.kind <= ts.SyntaxKind.LastTemplateToken || n.kind === ts.SyntaxKind.Identifier || (n.kind >= ts.SyntaxKind.ArrayLiteralExpression && n.kind <= ts.SyntaxKind.SyntheticExpression);
    ts.forEachChild(n, c => {
      const cb = c.kind === ts.SyntaxKind.BinaryExpression ? (n.kind === ts.SyntaxKind.BinaryExpression ? bin + 1 : 1) : 0;
      const isAcc = c.kind === ts.SyntaxKind.CallExpression || c.kind === ts.SyntaxKind.PropertyAccessExpression || c.kind === ts.SyntaxKind.ElementAccessExpression || c.kind === ts.SyntaxKind.NonNullExpression;
      const ca = isAcc ? acc + 1 : 0;
      const cp = c.kind === ts.SyntaxKind.ParenthesizedExpression ? par + 1 : (c.kind === ts.SyntaxKind.BinaryExpression || isAcc ? par : 0);
      const cc = c.kind === ts.SyntaxKind.ConditionalExpression ? cond + 1 : cond;
      const ci = c.kind === ts.SyntaxKind.IfStatement && n.kind === ts.SyntaxKind.IfStatement ? ie + 1 : 0;
      stack.push([c, d + 1, isExpr || ed > 0 ? ed + 1 : (c.kind >= ts.SyntaxKind.ArrayLiteralExpression && c.kind <= ts.SyntaxKind.SyntheticExpression ? 1 : 0), cb, ca, cp, cc, ci]);
    });
  }
  rows.push([file.replace("/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases/", ""), maxDepth, maxExprDepth, maxBin, maxAccess, maxParen, maxCond, maxIfElse, maxStmts, text.length].join("\t"));
}
fs.writeFileSync(out, "file\tmaxNodeDepth\tmaxExprDepth\tmaxNestedBinary\tmaxAccessChain\tmaxParen\tmaxConditionalNesting\tmaxElseIfChain\tmaxStatementsInList\tbytes\n" + rows.join("\n") + "\n");
