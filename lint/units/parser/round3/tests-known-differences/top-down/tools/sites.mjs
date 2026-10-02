// usage: node sites.mjs   for every row that tsc parses: the places where TypeScript-only syntax stands, by the node that owns it
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const ts = createRequire(import.meta.url)("/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const K = ts.SyntaxKind;
const rows = JSON.parse(readFileSync("/tmp/r4/testrows.json", "utf8"));
const cls = JSON.parse(readFileSync("/tmp/r4/rows.class.json", "utf8"));
const kindOf = l => (l === "tsx" ? ts.ScriptKind.TSX : l === "js" ? ts.ScriptKind.JS : ts.ScriptKind.TS);
const name = k => { const n = K[k]; return n === "FirstTypeNode" ? "TypePredicate" : n === "LastTypeNode" ? "ImportType" : n; };
function sitesOf(src, loader) {
  const sf = ts.createSourceFile(loader === "tsx" ? "/a.tsx" : loader === "js" ? "/a.js" : "/a.ts", src, ts.ScriptTarget.Latest, true, kindOf(loader));
  const out = new Set();
  const isTypeSide = n => ts.isTypeNode(n) || ts.isTypeElement(n) && !ts.isClassElement(n);
  const visit = (n, inType) => {
    const p = n.parent;
    if (!inType) {
      if (ts.isTypeNode(n) && n.kind !== K.ExpressionWithTypeArguments) {
        // The site that reads this type root.
        let site;
        if (p.kind === K.VariableDeclaration) site = p.parent.parent.kind === K.VariableStatement && p.parent.parent.modifiers?.some(m => m.kind === K.DeclareKeyword) ? "declare var annotation" : "variable annotation";
        else if (p.kind === K.TypeAliasDeclaration) site = "type alias: right side";
        else if (p.kind === K.Parameter) {
          const f = p.parent;
          site = f.kind === K.ArrowFunction ? "arrow parameter annotation" : f.kind === K.IndexSignature ? "class index signature: parameter" : `${name(f.kind)} parameter annotation`;
        } else if (p.kind === K.ArrowFunction) site = "arrow return type";
        else if (p.kind === K.FunctionDeclaration || p.kind === K.FunctionExpression || p.kind === K.MethodDeclaration || p.kind === K.GetAccessor || p.kind === K.SetAccessor || p.kind === K.Constructor) site = `${name(p.kind)} return type`;
        else if (p.kind === K.AsExpression) site = "as";
        else if (p.kind === K.SatisfiesExpression) site = "satisfies";
        else if (p.kind === K.TypeAssertionExpression) site = "type assertion <T>x";
        else if (p.kind === K.PropertyDeclaration) site = "class property annotation";
        else if (p.kind === K.IndexSignature) site = "class index signature: type";
        else if (p.kind === K.TypeParameter) site = `type parameter of ${name(p.parent.kind)}`;
        else if (p.kind === K.CallExpression || p.kind === K.NewExpression || p.kind === K.TaggedTemplateExpression) site = `type arguments of ${name(p.kind)}`;
        else if (p.kind === K.ExpressionWithTypeArguments) site = `type arguments in ${p.parent.token === K.ExtendsKeyword ? "extends" : "implements"} of ${name(p.parent.parent.kind)}`;
        else site = `type under ${name(p.kind)}`;
        out.add(site);
        return;
      }
      if (n.kind === K.InterfaceDeclaration) { out.add("interface: heritage and members"); if (n.typeParameters) out.add("type parameter of InterfaceDeclaration"); return; }
      if (n.kind === K.TypeParameter) { out.add(`type parameter of ${name(p.kind)}`); }
      if (n.kind === K.HeritageClause && n.token === K.ImplementsKeyword) out.add("class implements");
      if (n.kind === K.IndexSignature && ts.isClassLike(p)) out.add("class index signature");
      if (n.kind === K.EnumDeclaration) out.add("enum");
      if (n.kind === K.ModuleDeclaration) out.add("namespace");
      if (n.kind === K.NonNullExpression) out.add("non-null !");
      if (ts.isParameter(n) && n.modifiers?.length) out.add(`modifier on parameter of ${name(p.kind)}`);
      if (ts.canHaveModifiers(n) && ts.getModifiers(n)?.some(m => m.kind === K.DeclareKeyword)) out.add(`declare ${name(n.kind)}`);
      if (ts.canHaveModifiers(n) && ts.getModifiers(n)?.some(m => m.kind === K.AbstractKeyword)) out.add(`abstract ${name(n.kind)}`);
      if (ts.canHaveModifiers(n) && ts.getModifiers(n)?.some(m => m.kind === K.AccessorKeyword)) out.add("accessor modifier");
    }
    ts.forEachChild(n, c => visit(c, inType));
  };
  visit(sf, false);
  return { sites: [...out], parses: sf.parseDiagnostics.length === 0 };
}
const table = new Map();
const perRow = rows.map((r, i) => {
  const { sites, parses } = sitesOf(r.src, r.loader);
  const key = `${cls[i].class}\t${cls[i].family}`;
  for (const s of sites) {
    const k2 = `${key}\t${s}`;
    table.set(k2, (table.get(k2) ?? 0) + 1);
  }
  return { i, class: cls[i].class, family: cls[i].family, sites, parses };
});
writeFileSync("/tmp/r4/rows.sites.json", JSON.stringify(perRow));
for (const [k, v] of [...table].sort()) console.log(`${v}\t${k}`);
// by site only, classes T and M
const bySite = new Map();
for (const r of perRow) for (const s of r.sites) { if (!bySite.has(s)) bySite.set(s, { T: 0, M: 0, O: 0, X: 0 }); bySite.get(s)[r.class[0]]++; }
console.log("\n## rows by site (T, M, O-*, X)");
for (const [s, c] of [...bySite].sort()) console.log(`${String(c.T).padStart(4)}${String(c.M).padStart(4)}${String(c.O).padStart(4)}${String(c.X).padStart(4)}  ${s}`);
