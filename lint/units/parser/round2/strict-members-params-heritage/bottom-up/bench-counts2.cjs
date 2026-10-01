const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs"), path = require("path");
const root = "/workspace/notes/lint/benchroot";
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, out); } else out.push(p); } return out; };
const groups = {
  "bun-types": walk(root + "/packages/bun-types").filter(f => f.endsWith(".d.ts") && !f.includes("/ts7.1/")),
  "typescript-lib": fs.readdirSync(root + "/node_modules/typescript/lib").filter(f => /^lib.*\.d\.ts$/.test(f)).map(f => root + "/node_modules/typescript/lib/" + f),
  "src-js": walk(root + "/src/js").filter(f => f.endsWith(".ts")),
  "tsx": [root + "/bench/snippets/transpiler-typescript-fixture.tsx"],
  "js-control": [root + "/bench/react-hello-world/react-hello-world.node.js"],
};
const K = ts.SyntaxKind;
for (const [g, files] of Object.entries(groups)) {
  const c = { decorators: 0, classes: 0, classMembersComputedName: 0, interfaces: 0, typeAliases: 0, ctors: 0, ctorsWithParamProps: 0, keywordShorthandBinding: 0, objectBindingProps: 0, methodsWithExcl: 0 };
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : f.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS);
    (function visit(n) {
      if (n.kind === K.Decorator) c.decorators++;
      if (ts.isClassLike(n)) c.classes++;
      if (n.kind === K.InterfaceDeclaration) c.interfaces++;
      if (n.kind === K.TypeAliasDeclaration) c.typeAliases++;
      if (n.kind === K.Constructor) { c.ctors++; if (n.parameters.some(p => (p.modifiers || []).some(m => m.kind !== K.Decorator))) c.ctorsWithParamProps++; }
      if (ts.isClassElement(n) && n.name && n.name.kind === K.ComputedPropertyName) c.classMembersComputedName++;
      if (n.kind === K.BindingElement && n.parent.kind === K.ObjectBindingPattern) c.objectBindingProps++;
      ts.forEachChild(n, visit);
    })(sf);
  }
  console.log(g, JSON.stringify(c));
}
