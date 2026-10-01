// Scans the test cases of the TypeScript submodule and prints, per file, the tree depth and the longest chain of directly nested
// expressions (parent and child both expressions), with TypeScript 6.0.2. Output: TSV sorted by expression chain, top N.
const ts = require('/workspace/wt/typecheck/node_modules/typescript');
const fs = require('fs'), path = require('path');
const root = '/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases';
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(e.name)) files.push(p); } })(root + '/compiler');
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(e.name)) files.push(p); } })(root + '/conformance');
const rows = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.jsx$/.test(file) ? ts.ScriptKind.JSX : /\.[mc]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  let sf;
  try { sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, false, kind); } catch (e) { rows.push([file, -1, -1, -1, 0]); continue; }
  let maxDepth = 0, maxExpr = 0, maxStmt = 0, nodes = 0;
  const stack = [[sf, 0, 0, 0]];
  while (stack.length) {
    const [n, d, e, s] = stack.pop();
    nodes++;
    if (d > maxDepth) maxDepth = d;
    const isExpr = n.kind >= ts.SyntaxKind.ArrayLiteralExpression && n.kind <= ts.SyntaxKind.SyntheticExpression || n.kind === ts.SyntaxKind.Identifier || n.kind === ts.SyntaxKind.JsxElement || n.kind === ts.SyntaxKind.JsxSelfClosingElement || n.kind === ts.SyntaxKind.JsxFragment || n.kind === ts.SyntaxKind.JsxExpression;
    const ne = isExpr ? e + 1 : 0;
    if (ne > maxExpr) maxExpr = ne;
    const isStmt = n.kind >= ts.SyntaxKind.Block && n.kind <= ts.SyntaxKind.DebuggerStatement;
    const ns = isStmt ? s + 1 : s;
    if (ns > maxStmt) maxStmt = ns;
    ts.forEachChild(n, c => { stack.push([c, d + 1, ne, ns]); });
  }
  rows.push([file.slice(root.length + 1), maxDepth, maxExpr, maxStmt, nodes]);
}
rows.sort((a, b) => b[2] - a[2]);
console.log('files', rows.length);
console.log('file\ttree depth\tdirectly nested expressions\tnested statements\tnodes');
for (const r of rows.slice(0, +process.argv[2] || 25)) console.log(r.join('\t'));
const hist = [50, 100, 200, 500, 1000, 2000, 4000].map(t => t + ':' + rows.filter(r => r[2] > t).length);
console.log('files with a chain of directly nested expressions longer than N: ' + hist.join(' '));
rows.sort((a, b) => b[1] - a[1]);
console.log('by tree depth: ' + rows.slice(0, 12).map(r => r[0].split('/').pop() + '=' + r[1]).join(' '));
rows.sort((a, b) => b[3] - a[3]);
console.log('by nested statements: ' + rows.slice(0, 12).map(r => r[0].split('/').pop() + '=' + r[3]).join(' '));
rows.sort((a, b) => b[4] - a[4]);
console.log('by nodes: ' + rows.slice(0, 8).map(r => r[0].split('/').pop() + '=' + r[4]).join(' '));
