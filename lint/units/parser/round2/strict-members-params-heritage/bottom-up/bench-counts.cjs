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
  const c = { files: files.length, classIndexSig: 0, classMemberQuestion: 0, classMemberExcl: 0, ctorParamProp: 0, paramModifierNonCtor: 0, shorthandBinding: 0, keywordNamedBindingProp: 0, classExtends: 0, classImplements: 0, accessorInClass: 0, computedClassKeyThenColon: 0, interfaceHeritage: 0, decoratedMembers: 0, thisParam: 0, restParam: 0 };
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : f.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS);
    (function visit(n) {
      if (n.kind === K.IndexSignature && ts.isClassLike(n.parent)) c.classIndexSig++;
      if (ts.isClassLike(n.parent || {}) && n.parent.members && n.parent.members.includes(n)) {
        if (n.questionToken) c.classMemberQuestion++;
        if (n.exclamationToken) c.classMemberExcl++;
        if (n.kind === K.GetAccessor || n.kind === K.SetAccessor) c.accessorInClass++;
        if ((n.modifiers || []).some(m => m.kind === K.Decorator)) c.decoratedMembers++;
      }
      if (n.kind === K.Parameter) {
        const mods = (n.modifiers || []).filter(m => m.kind !== K.Decorator);
        if (mods.length) { if (n.parent.kind === K.Constructor) c.ctorParamProp++; else c.paramModifierNonCtor++; }
        if (n.name.kind === K.Identifier && n.name.text === "this") c.thisParam++;
        if (n.dotDotDotToken) c.restParam++;
      }
      if (n.kind === K.BindingElement && n.parent.kind === K.ObjectBindingPattern) {
        if (!n.propertyName && !n.dotDotDotToken) c.shorthandBinding++;
        if (n.propertyName && n.propertyName.kind === K.Identifier && ts.identifierToKeywordKind(n.propertyName) !== undefined && ts.identifierToKeywordKind(n.propertyName) <= K.LastReservedWord) c.keywordNamedBindingProp++;
      }
      if (n.kind === K.HeritageClause) {
        if (ts.isClassLike(n.parent)) { if (n.token === K.ExtendsKeyword) c.classExtends++; else c.classImplements++; }
        else c.interfaceHeritage++;
      }
      ts.forEachChild(n, visit);
    })(sf);
  }
  console.log(g, JSON.stringify(c));
}
