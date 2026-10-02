// usage: node outline-check.mjs   the outline of every type root of every row, made here from the source of the row, against rows.facts.json of the bottom-up pass
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const ts = createRequire(import.meta.url)("/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const K = ts.SyntaxKind;
const names = new Map();
for (const [name, value] of Object.entries(K)) if (typeof value === "number" && !names.has(value)) names.set(value, name);
const kindOf = l => (l === "tsx" ? ts.ScriptKind.TSX : l === "js" ? ts.ScriptKind.JS : ts.ScriptKind.TS);
function outline(sf, root, offset) {
  const out = [];
  const range = list => `${list.pos - offset},${list.end - offset}`;
  const visit = node => {
    if (ts.isTypeNode(node) && node.kind !== K.TemplateLiteralTypeSpan) {
      let line = `${names.get(node.kind)}[${node.getStart(sf) - offset},${node.end - offset})`;
      if (node.typeArguments) line += `<${range(node.typeArguments)}>`;
      if ((ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) && node.typeParameters) line += `{${range(node.typeParameters)}}`;
      out.push(line);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out.join(" ");
}
// The type roots of a source: type nodes whose parent is no type node and no member of a type.
function roots(src, loader) {
  const sf = ts.createSourceFile(loader === "tsx" ? "/a.tsx" : loader === "js" ? "/a.js" : "/a.ts", src, ts.ScriptTarget.Latest, true, kindOf(loader));
  const found = [];
  const visit = n => {
    if (ts.isTypeNode(n) && n.kind !== K.ExpressionWithTypeArguments) {
      found.push({ start: n.getStart(sf), end: n.end, parent: names.get(n.parent.kind), outline: outline(sf, n, n.getStart(sf)) });
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { found, diags: sf.parseDiagnostics.length };
}
const rows = JSON.parse(readFileSync("/tmp/r4/testrows.json", "utf8"));
const theirs = JSON.parse(readFileSync("/workspace/notes/lint/units/parser/round3/tests-known-differences/bottom-up/rows.facts.json", "utf8"));
let same = 0, differ = 0, missing = 0, extra = 0, total = 0;
const mine = rows.map((r, i) => {
  const { found, diags } = roots(r.src, r.loader);
  const t = theirs[i].roots ?? [];
  for (const f of found) {
    total++;
    const m = t.find(x => x.start === f.start && x.end === f.end);
    if (!m) { missing++; if (missing <= 12) console.log("not in theirs", i, JSON.stringify(r.src), f.parent, f.start, f.end, f.outline); continue; }
    if (m.outline === f.outline) same++; else { differ++; console.log("DIFFER", i, JSON.stringify(r.src), "\n  mine  ", f.outline, "\n  theirs", m.outline); }
  }
  for (const x of t) if (!found.find(f => f.start === x.start && f.end === x.end)) { extra++; if (extra <= 12) console.log("only in theirs", i, JSON.stringify(r.src), JSON.stringify(x)); }
  return { i, roots: found, diags };
});
writeFileSync("/tmp/r4/rows.roots.json", JSON.stringify(mine));
console.log({ total, same, differ, missing, extra });
