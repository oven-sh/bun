const ts = require("/workspace/bun/node_modules/typescript");
const fs = require("fs"), path = require("path");
const root = "/workspace/notes/lint/benchroot";
function walk(dir, out, pred) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, out, pred); } else if (pred(p)) out.push(p); } return out; }
const groups = [
  ["bun-types", walk(path.join(root, "packages/bun-types"), [], p => p.endsWith(".d.ts") && !p.includes("/ts7.1/")), ts.ScriptKind.TS],
  ["typescript-lib", fs.readdirSync(path.join(root, "node_modules/typescript/lib")).filter(f => /^lib.*\.d\.ts$/.test(f)).map(f => path.join(root, "node_modules/typescript/lib", f)), ts.ScriptKind.TS],
  ["src-js", walk(path.join(root, "src/js"), [], p => p.endsWith(".ts")), ts.ScriptKind.TS],
  ["tsx", [path.join(root, "bench/snippets/transpiler-typescript-fixture.tsx")], ts.ScriptKind.TSX],
  ["js-control", [path.join(root, "bench/react-hello-world/react-hello-world.node.js")], ts.ScriptKind.JS],
];
const SK = ts.SyntaxKind; const has = (n, k) => !!(n.modifiers && n.modifiers.some(m => m.kind === k));
const all = {}; const keys = new Set();
for (const [name, files, kind] of groups) {
  const c = Object.create(null); const inc = (k, n = 1) => { c[k] = (c[k] || 0) + n; keys.add(k); };
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const visit = (n, nested) => {
      const k = n.kind;
      const isStmtList = ts.isSourceFile(n) || k === SK.ModuleBlock || k === SK.Block;
      if (isStmtList) for (const s of n.statements) {
        const ex = has(s, SK.ExportKeyword), de = has(s, SK.DeclareKeyword), df = has(s, SK.DefaultKeyword);
        // the pre-check of parse_stmt_fallthrough with a lookahead: keyword type/interface always, namespace/module unless the scope is nested
        if (s.kind === SK.InterfaceDeclaration) { if (!df) inc("precheck.lookahead.interface"); else inc("export_default.interface"); }
        if (s.kind === SK.TypeAliasDeclaration) { if (ex && !de) inc("export_type_alias(no precheck)"); else inc("precheck.lookahead.type"); }
        if (s.kind === SK.ModuleDeclaration) {
          const kw = text.slice(s.getStart(sf), s.getStart(sf) + 80).replace(/^(export\s+)?(declare\s+)?/, "").match(/^[a-z]+/);
          const word = kw ? kw[0] : "?";
          if (word === "global") inc("stmt.global");
          else if (nested) inc("precheck.nested_namespace(no lookahead)");
          else inc("precheck.lookahead." + word);
        }
        if (de) inc("declare.stmt." + SK[s.kind]);
        if (s.kind === SK.FunctionDeclaration && !s.body) inc("fn_stmt.no_body");
        if (s.kind === SK.ExpressionStatement) inc("stmt.expression");
        if (s.kind === SK.VariableStatement) { const f = s.declarationList.flags; inc(f & ts.NodeFlags.Let ? "stmt.let" : f & ts.NodeFlags.Const ? "stmt.const" : "stmt.var"); }
      }
      if (k === SK.MethodDeclaration) inc(n.parent.kind === SK.ObjectLiteralExpression ? "method.object_literal" : "method.class");
      if (k === SK.GetAccessor || k === SK.SetAccessor) inc("accessor_decl");
      if (k === SK.Constructor) inc("ctor_decl");
      if (k === SK.ClassDeclaration || k === SK.ClassExpression) { let parsed = 0; for (const m of n.members) { const dropped = m.kind === SK.IndexSignature || ((m.kind === SK.MethodDeclaration || m.kind === SK.Constructor || m.kind === SK.GetAccessor || m.kind === SK.SetAccessor) && !m.body) || (m.kind === SK.PropertyDeclaration && (has(m, SK.DeclareKeyword) || has(m, SK.AbstractKeyword))); if (!dropped) parsed++; if (m.kind === SK.SemicolonClassElement) inc("class.semicolon_member"); } inc("class.member.parsed", parsed); }
      if (k === SK.TypeLiteral || k === SK.InterfaceDeclaration) {
        const ms = n.members; if (k === SK.TypeLiteral && ms.length) { const f = ms[0]; const t = text.slice(f.getStart(sf), f.getStart(sf) + 9); if (/^\[|^[+-]|^readonly\b/.test(t)) inc("type_literal.first_member_triggers_mapped_scan"); }
        for (const m of ms) { if (has(m, SK.ReadonlyKeyword)) inc("type.member.readonly"); if (m.questionToken) inc("type.member.optional"); }
      }
      if (k === SK.MappedType) inc("mapped_type");
      if (k === SK.TupleType) for (const e of n.elements) { const t = text.slice(e.getStart(sf), e.getStart(sf) + 3); if (/^[A-Za-z_$]|^\.\.\./.test(t)) inc("tuple.element.lookahead"); else inc("tuple.element.no_lookahead"); }
      if (k === SK.ConditionalExpression && n.whenTrue.kind === SK.ParenthesizedExpression) inc("cond.true_is_paren");
      if (k === SK.Parameter && n.parent && (n.parent.kind === SK.FunctionDeclaration || n.parent.kind === SK.FunctionExpression || n.parent.kind === SK.MethodDeclaration || n.parent.kind === SK.Constructor || n.parent.kind === SK.SetAccessor) && ts.isIdentifier(n.name) && n.name.escapedText !== "this") { if (kind !== ts.ScriptKind.JS) inc("parse_fn.param.identifier.ts"); }
      const nestedNext = nested || k === SK.Block || ts.isFunctionLike(n);
      ts.forEachChild(n, ch => visit(ch, nestedNext));
    };
    visit(sf, false);
  }
  all[name] = c;
}
const names = groups.map(g => g[0]);
console.log("per ONE pass".padEnd(52) + names.map(n => n.padStart(15)).join(""));
for (const k of [...keys].sort()) console.log(k.padEnd(52) + names.map(n => String(all[n][k] || 0).padStart(15)).join(""));
