// Counts, per group of the transpiler benchmark, the expressions that start with "(" as Bun's pfx_t_open_paren meets them:
// parenthesized expressions and arrow functions whose parameters stand in parentheses (no `async`, no type parameters).
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs"), path = require("path");
const root = "/workspace/notes/lint/benchroot";
function walk(dir, test, skip, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !skip.includes(e.name)) walk(p, test, skip, out); }
    else if (test(p)) out.push(p);
  }
  return out;
}
const groups = [
  ["bun-types", walk(path.join(root, "packages/bun-types"), p => p.endsWith(".d.ts"), ["ts7.1"])],
  ["typescript-lib", fs.readdirSync(path.join(root, "node_modules/typescript/lib")).filter(n => /^lib.*\.d\.ts$/.test(n)).map(n => path.join(root, "node_modules/typescript/lib", n))],
  ["src-js", walk(path.join(root, "src/js"), p => p.endsWith(".ts") , [])],
  ["tsx", [path.join(root, "bench/snippets/transpiler-typescript-fixture.tsx")]],
  ["js-control", [path.join(root, "bench/react-hello-world/react-hello-world.node.js")]],
];
for (const [name, files] of groups) {
  let bytes = 0, paren = 0, arrow = 0;
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    bytes += Buffer.byteLength(text);
    const kind = f.endsWith(".tsx") ? ts.ScriptKind.TSX : f.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, false, kind);
    const visit = n => {
      if (n.kind === ts.SyntaxKind.ParenthesizedExpression) paren++;
      else if (n.kind === ts.SyntaxKind.ArrowFunction && !n.typeParameters && !(n.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.AsyncKeyword) && text[n.getStart(sf)] === "(") arrow++;
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  const total = paren + arrow;
  console.log(`${name.padEnd(15)} files ${String(files.length).padStart(4)}  bytes ${String(bytes).padStart(8)}  parenthesized ${String(paren).padStart(6)}  arrow( ${String(arrow).padStart(6)}  total ${String(total).padStart(6)}  per KB ${(total / (bytes / 1000)).toFixed(2)}`);
}
