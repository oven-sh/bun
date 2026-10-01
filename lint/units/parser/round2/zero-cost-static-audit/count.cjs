// Counts, per cgbench group and per ONE pass over the group, how often each parser site of the audit runs.
// usage: node count.cjs   (reads /workspace/notes/lint/benchroot, tsc 6.0.2 from /workspace/bun/node_modules)
const ts = require("/workspace/bun/node_modules/typescript");
const fs = require("fs");
const path = require("path");
const root = "/workspace/notes/lint/benchroot";

function walk(dir, out, pred) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walk(p, out, pred);
    } else if (pred(p)) out.push(p);
  }
  return out;
}
const groups = [
  { name: "bun-types", files: walk(path.join(root, "packages/bun-types"), [], p => p.endsWith(".d.ts") && !p.includes("/ts7.1/")), kind: ts.ScriptKind.TS, repeat: 1 },
  { name: "typescript-lib", files: fs.readdirSync(path.join(root, "node_modules/typescript/lib")).filter(f => /^lib.*\.d\.ts$/.test(f)).map(f => path.join(root, "node_modules/typescript/lib", f)), kind: ts.ScriptKind.TS, repeat: 1 },
  { name: "src-js", files: walk(path.join(root, "src/js"), [], p => p.endsWith(".ts")), kind: ts.ScriptKind.TS, repeat: 1 },
  { name: "tsx", files: [path.join(root, "bench/snippets/transpiler-typescript-fixture.tsx")], kind: ts.ScriptKind.TSX, repeat: 100 },
  { name: "js-control", files: [path.join(root, "bench/react-hello-world/react-hello-world.node.js")], kind: ts.ScriptKind.JS, repeat: 1 },
];
const BUN_KEYWORDS = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with".split(" "));
const STMT_KW = new Set(["type", "namespace", "module", "interface", "abstract", "global", "declare"]);
const MEMBER_KW = new Set("get set static abstract accessor async declare out override private protected public readonly".split(" "));
const SK = ts.SyntaxKind;
const has = (n, k) => !!(n.modifiers && n.modifiers.some(m => m.kind === k));

function countGroup(g) {
  const c = Object.create(null);
  const inc = (k, n = 1) => { c[k] = (c[k] || 0) + n; };
  let bytes = 0;
  for (const file of g.files) {
    const text = fs.readFileSync(file, "utf8");
    bytes += Buffer.byteLength(text);
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, g.kind);
    const isTS = g.kind !== ts.ScriptKind.JS;
    const firstTokText = n => { const s = n.getStart(sf); const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(s, s + 40)); return m ? m[0] : null; };
    // ambient: inside a `declare` statement or module block of one
    const visit = (n, ambient, inType) => {
      const k = n.kind;
      // ---------- statements ----------
      if (ts.isSourceFile(n) || k === SK.ModuleBlock || k === SK.Block || k === SK.CaseClause || k === SK.DefaultClause) {
        for (const s of n.statements) {
          inc("stmt.total");
          const w = firstTokText(s);
          if (w && !BUN_KEYWORDS.has(w)) {
            inc("stmt.identifier_led");
            if (STMT_KW.has(w)) inc("stmt.identifier_led.ts_keyword." + w);
            else if (w === "let" || w === "async" || w === "using" || w === "await") inc("stmt.identifier_led.word." + w);
            else inc("stmt.identifier_led.other");
          }
          const declared = has(s, SK.DeclareKeyword);
          const erased = s.kind === SK.InterfaceDeclaration || s.kind === SK.TypeAliasDeclaration || declared || ambient ||
            (s.kind === SK.FunctionDeclaration && !s.body) ||
            (s.kind === SK.ImportDeclaration && s.importClause && s.importClause.isTypeOnly) ||
            (s.kind === SK.ExportDeclaration && s.isTypeOnly) ||
            s.kind === SK.NamespaceExportDeclaration ||
            (s.kind === SK.ImportEqualsDeclaration && s.isTypeOnly);
          if (erased && isTS) inc("stmt.erased(STypeScript)");
          if (declared) inc("stmt.declare_modifier");
        }
      }
      const nextAmbient = ambient || has(n, SK.DeclareKeyword);
      switch (k) {
        case SK.InterfaceDeclaration: inc("interface"); if (n.typeParameters) inc("interface.type_params"); if (n.heritageClauses) for (const h of n.heritageClauses) inc("interface.heritage_entries", h.types.length); break;
        case SK.TypeAliasDeclaration: inc("type_alias"); if (n.typeParameters) inc("type_alias.type_params"); break;
        case SK.ModuleDeclaration: inc("namespace_or_module"); break;
        case SK.EnumDeclaration: inc("enum"); inc("enum.members", n.members.length); if (nextAmbient) inc("enum.declare"); break;
        case SK.ImportDeclaration: case SK.ExportDeclaration:
          if (n.moduleSpecifier) {
            inc("import_export.path");
            const after = text.slice(n.moduleSpecifier.end, n.moduleSpecifier.end + 200);
            const m = /^[ \t]*(\/\*[^]*?\*\/[ \t]*)*(.|\n|\r|$)/.exec(after);
            if (m && (m[2] === "\n" || m[2] === "\r" || m[2] === "/" || m[2] === "")) inc("import_export.path_then_newline");
          }
          if (k === SK.ImportDeclaration && n.importClause && n.importClause.isTypeOnly) inc("import.type_only");
          if (k === SK.ExportDeclaration && n.isTypeOnly) inc("export.type_only");
          break;
        case SK.ImportEqualsDeclaration: inc("import_equals"); break;
        case SK.VariableDeclaration: inc("var_decl"); if (n.type || n.exclamationToken) inc("var_decl.typed"); break;
        case SK.CatchClause: if (n.variableDeclaration && n.variableDeclaration.type) inc("catch.typed"); break;
        // ---------- functions parsed by parse_fn ----------
        case SK.FunctionDeclaration: case SK.FunctionExpression: case SK.MethodDeclaration: case SK.Constructor: case SK.GetAccessor: case SK.SetAccessor: {
          inc("fn(parse_fn)");
          if (n.body) inc("fn(parse_fn).with_body"); else inc("fn(parse_fn).no_body");
          if (n.typeParameters) inc(k === SK.MethodDeclaration ? "method.type_params" : "fn.type_params");
          if (n.type) { inc("fn(parse_fn).return_type"); const w = firstTokText(n.type); if (w && !BUN_KEYWORDS.has(w)) inc("return_type.identifier_led"); }
          for (const p of n.parameters) {
            const isThis = ts.isIdentifier(p.name) && p.name.escapedText === "this";
            if (isThis) { inc("fn(parse_fn).this_param"); continue; }
            inc("fn(parse_fn).params");
            if (ts.isIdentifier(p.name)) { inc("fn(parse_fn).params.identifier"); if (k !== SK.Constructor && !p.dotDotDotToken) inc("fn(parse_fn).params.identifier.non_ctor_non_rest"); }
            if (p.type) inc("fn(parse_fn).params.typed");
            if (p.dotDotDotToken) inc("fn(parse_fn).params.rest");
          }
          break;
        }
        case SK.ArrowFunction: {
          inc("arrow");
          const t = text.slice(n.getStart(sf), n.getStart(sf) + 6);
          const isAsync = has(n, SK.AsyncKeyword);
          const paren = n.getChildren(sf).some(ch => ch.kind === SK.OpenParenToken);
          if (paren) inc("arrow.paren"); else inc("arrow.single_ident");
          if (paren && !isAsync && !n.typeParameters) inc("paren_prefix.arrow");
          if (paren && isAsync && !n.typeParameters) inc("async_paren.arrow");
          if (n.typeParameters) inc(isAsync ? "arrow.type_params.async" : "arrow.type_params");
          if (n.type) { inc("arrow.return_type"); const w = firstTokText(n.type); if (w && !BUN_KEYWORDS.has(w)) inc("return_type.identifier_led"); }
          for (const p of n.parameters) if (p.type) inc("arrow.params.typed");
          void t;
          break;
        }
        case SK.ParenthesizedExpression: inc("paren_prefix.parenthesized"); break;
        case SK.CallExpression:
          if (ts.isIdentifier(n.expression) && n.expression.escapedText === "async") inc("async_paren.call");
          if (n.typeArguments) inc("lt_suffix.call_type_args");
          if (n.questionDotToken && n.typeArguments) inc("optional_call_type_args");
          break;
        case SK.NewExpression: if (n.typeArguments) inc("new.type_args"); break;
        case SK.TaggedTemplateExpression: if (n.typeArguments) inc("lt_suffix.tagged_type_args"); break;
        case SK.ExpressionWithTypeArguments: if (n.typeArguments && !inType && n.parent.kind !== SK.HeritageClause) inc("lt_suffix.instantiation"); break;
        case SK.BinaryExpression:
          if (n.operatorToken.kind === SK.LessThanToken) inc("lt_suffix.binary_lt");
          if (n.operatorToken.kind === SK.LessThanLessThanToken) inc("lt_suffix.binary_shl");
          break;
        case SK.AsExpression: inc("as"); break;
        case SK.SatisfiesExpression: inc("satisfies"); break;
        case SK.NonNullExpression: inc("non_null"); break;
        case SK.TypeAssertionExpression: inc("type_assertion_prefix"); break;
        case SK.JsxOpeningElement: case SK.JsxSelfClosingElement: inc("jsx.element"); if (n.typeArguments) inc("jsx.element.type_args"); break;
        case SK.Decorator: inc("decorator"); break;
        // ---------- classes ----------
        case SK.ClassDeclaration: case SK.ClassExpression: {
          inc("class");
          if (n.typeParameters) inc("class.type_params");
          if (nextAmbient) inc("class.declare");
          if (n.heritageClauses) for (const h of n.heritageClauses) {
            if (h.token === SK.ExtendsKeyword) inc("class.extends"); else { inc("class.implements"); inc("class.implements.entries", h.types.length); }
          }
          for (const m of n.members) {
            inc("class.member");
            if (m.kind === SK.IndexSignature) { inc("class.member.index_signature"); inc("class.member.dropped"); }
            else if (m.name && m.name.kind === SK.ComputedPropertyName) {
              inc("class.member.computed");
              if (ts.isIdentifier(m.name.expression) || (ts.isPropertyAccessExpression(m.name.expression))) {
                const w = firstTokText(m.name.expression);
                if (w && !BUN_KEYWORDS.has(w)) inc("class.member.computed.identifier_first");
              }
            }
            if (m.kind === SK.PropertyDeclaration) { inc("class.member.property"); if (m.type) inc("class.member.property.typed"); if (has(m, SK.DeclareKeyword) || has(m, SK.AbstractKeyword)) inc("class.member.dropped"); }
            if ((m.kind === SK.MethodDeclaration || m.kind === SK.Constructor || m.kind === SK.GetAccessor || m.kind === SK.SetAccessor) && !m.body) inc("class.member.dropped");
            if (has(m, SK.AccessorKeyword)) inc("class.member.accessor_keyword");
          }
          break;
        }
        case SK.ObjectLiteralExpression:
          for (const m of n.properties) if (m.name && m.name.kind === SK.ComputedPropertyName) inc("object.computed_key");
          break;
        // ---------- type grammar ----------
        case SK.TypeLiteral: case SK.MappedType:
          inc(k === SK.MappedType ? "type.mapped" : "type.literal");
          break;
        case SK.PropertySignature: case SK.MethodSignature: case SK.CallSignature: case SK.ConstructSignature: case SK.IndexSignature: case SK.GetAccessor + 100000: {
          if (n.parent.kind === SK.ClassDeclaration || n.parent.kind === SK.ClassExpression) break;
          inc("type.member");
          if (k === SK.IndexSignature) inc("type.member.bracket");
          else if (n.name && n.name.kind === SK.ComputedPropertyName) inc("type.member.bracket");
          else if (n.name && ts.isIdentifier(n.name)) { inc("type.member.identifier_name"); if (MEMBER_KW.has(String(n.name.escapedText))) inc("type.member.name_is_modifier_word"); }
          if (n.modifiers) inc("type.member.modifiers", n.modifiers.length);
          if (n.parameters) { inc("type.signature"); inc("type.signature.params", n.parameters.length); for (const p of n.parameters) if (ts.isIdentifier(p.name)) inc("type.signature.params.identifier"); if (n.type) { inc("type.signature.return_type"); const w = firstTokText(n.type); if (w && !BUN_KEYWORDS.has(w)) inc("return_type.identifier_led"); } }
          break;
        }
        case SK.FunctionType: case SK.ConstructorType:
          inc("type.function"); inc("type.signature"); inc("type.signature.params", n.parameters.length);
          for (const p of n.parameters) if (ts.isIdentifier(p.name)) inc("type.signature.params.identifier");
          { inc("type.signature.return_type"); const w = firstTokText(n.type); if (w && !BUN_KEYWORDS.has(w)) inc("return_type.identifier_led"); }
          break;
        case SK.ParenthesizedType: inc("type.parenthesized"); break;
        case SK.TupleType: inc("type.tuple"); inc("type.tuple.elements", n.elements.length); break;
        case SK.NamedTupleMember: inc("type.tuple.named_elements"); break;
        case SK.TypeReference: inc("type.reference"); if (n.typeArguments) { inc("type.reference.type_args"); inc("type.type_argument", n.typeArguments.length); } break;
        case SK.ArrayType: inc("type.array"); break;
        case SK.IndexedAccessType: inc("type.indexed_access"); break;
        case SK.UnionType: inc("type.union"); inc("type.union.constituents", n.types.length); break;
        case SK.IntersectionType: inc("type.intersection"); inc("type.intersection.constituents", n.types.length); break;
        case SK.ConditionalType: inc("type.conditional"); break;
        case SK.InferType: inc("type.infer"); if (n.typeParameter.constraint) inc("type.infer.extends"); break;
        case SK.TypeOperator: inc("type.operator"); break;
        case SK.TypeQuery: inc("type.query"); break;
        case SK.ImportType: inc("type.import"); break;
        case SK.TypePredicate: inc("type.predicate"); break;
        case SK.LiteralType: inc("type.literal_type"); break;
        case SK.TemplateLiteralType: inc("type.template"); break;
        case SK.TypeParameter: inc("type_parameter"); break;
        default:
          if (k >= SK.FirstKeyword && k <= SK.LastKeyword && inType) inc("type.keyword");
      }
      if (ts.isTypeNode(n) && !inType) {
        inc("type.outermost");
        const w = firstTokText(n);
        if (w && !BUN_KEYWORDS.has(w)) inc("type.outermost.identifier_led");
      }
      if (ts.isTypeNode(n)) inc("type.node");
      ts.forEachChild(n, ch => visit(ch, nextAmbient, inType || ts.isTypeNode(n)));
    };
    visit(sf, false, false);
    // token-level counts
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, g.kind === ts.ScriptKind.TSX ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, text);
    void scanner;
  }
  c["files"] = g.files.length; c["bytes"] = bytes;
  return c;
}

const all = {};
const keys = new Set();
for (const g of groups) { all[g.name] = countGroup(g); for (const k of Object.keys(all[g.name])) keys.add(k); }
const names = groups.map(g => g.name);
const pad = (s, n) => String(s).padStart(n);
console.log("per ONE pass (cgbench runs 20 passes; tsx runs 100 repeats x 20)".padEnd(48) + names.map(n => pad(n, 15)).join(""));
for (const k of [...keys].sort()) console.log(k.padEnd(48) + names.map(n => pad(all[n][k] || 0, 15)).join(""));
fs.writeFileSync("/tmp/zc-audit/counts.json", JSON.stringify(all, null, 1));
