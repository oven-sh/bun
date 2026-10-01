// Probe: typescript-go's Parser.checkJSSyntax and checkJSDecoratorSyntax (parser.go:6707-6850) as a pass over a finished tree.
// Returns the diagnostics in the order in which the parser reports them: [pos, end, code, argument].
import { GOF } from "./convert.mjs";
const get = (n, name) => n?.children.get(name);
const nodesOf = (n, name) => n?.children.get(name)?.nodes ?? [];
const FUNCTION_LIKE = new Set(["MethodSignature", "CallSignature", "JSDocSignature", "ConstructSignature", "IndexSignature", "FunctionType", "ConstructorType",
  "Constructor", "FunctionExpression", "ArrowFunction", "MethodDeclaration", "GetAccessor", "SetAccessor", "FunctionDeclaration"]);
const MODIFIER_TEXT = { PublicKeyword: "public", PrivateKeyword: "private", ProtectedKeyword: "protected", ReadonlyKeyword: "readonly", OverrideKeyword: "override", ExportKeyword: "export",
  AbstractKeyword: "abstract", DeclareKeyword: "declare", StaticKeyword: "static", AccessorKeyword: "accessor", AsyncKeyword: "async", DefaultKeyword: "default", ConstKeyword: "const", InKeyword: "in", OutKeyword: "out" };
// ModifierFlagsJavaScript: export, static, accessor, async, default.
const JS_MODIFIERS = new Set(["ExportKeyword", "StaticKeyword", "AccessorKeyword", "AsyncKeyword", "DefaultKeyword"]);
const KEYWORD_TEXT = { NamespaceKeyword: "namespace", ModuleKeyword: "module", GlobalKeyword: "global" };
// ast.CanHaveIllegalDecorators and ast.CanHaveDecorators.
const ILLEGAL_DECORATORS = new Set(["PropertyAssignment", "ShorthandPropertyAssignment", "FunctionDeclaration", "Constructor", "IndexSignature", "ClassStaticBlockDeclaration", "MissingDeclaration",
  "VariableStatement", "InterfaceDeclaration", "TypeAliasDeclaration", "EnumDeclaration", "ModuleDeclaration", "ImportEqualsDeclaration", "ImportDeclaration", "JSImportDeclaration",
  "NamespaceExportDeclaration", "ExportDeclaration", "ExportAssignment"]);
const CAN_HAVE_DECORATORS = new Set(["Parameter", "PropertyDeclaration", "MethodDeclaration", "GetAccessor", "SetAccessor", "ClassExpression", "ClassDeclaration"]);

export function skipTrivia(b, pos) {
  for (;;) {
    const c = b[pos];
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c) { pos++; continue; }
    if (c === 0x2f && b[pos + 1] === 0x2f) { pos += 2; while (pos < b.length && b[pos] !== 0x0a && b[pos] !== 0x0d) pos++; continue; }
    if (c === 0x2f && b[pos + 1] === 0x2a) { pos += 2; while (pos < b.length && !(b[pos] === 0x2a && b[pos + 1] === 0x2f)) pos++; pos += 2; continue; }
    if (c === 0x23 && pos === 0 && b[1] === 0x21) { while (pos < b.length && b[pos] !== 0x0a && b[pos] !== 0x0d) pos++; continue; }
    if (c === 0xc2 && b[pos + 1] === 0xa0) { pos += 2; continue; }
    return pos;
  }
}

export function checkJS(root, textBytes) {
  const out = [];
  const err = (loc, code, arg) => out.push([skipTrivia(textBytes, loc.pos), loc.end, code, arg ?? ""]);
  const isReparsed = n => (n.flags & GOF.Reparsed) !== 0;

  function checkJSDecoratorSyntax(node) {
    const modifiers = nodesOf(node, "modifiers");
    if (modifiers.length === 0) return;
    if (ILLEGAL_DECORATORS.has(node.kind)) {
      const d = modifiers.find(m => m.kind === "Decorator");
      if (d) err(d, 1206);
    } else if (CAN_HAVE_DECORATORS.has(node.kind)) {
      const decoratorIndex = modifiers.findIndex(m => m.kind === "Decorator");
      if (decoratorIndex >= 0 && node.kind === "ClassDeclaration") {
        const exportIndex = modifiers.findIndex(m => m.kind === "ExportKeyword");
        if (exportIndex >= 0) {
          const defaultIndex = modifiers.findIndex(m => m.kind === "DefaultKeyword");
          if (decoratorIndex > exportIndex && defaultIndex >= 0 && decoratorIndex < defaultIndex) err(modifiers[decoratorIndex], 1206);
          else if (decoratorIndex < exportIndex) {
            let trailing = -1;
            for (let i = exportIndex; i < modifiers.length; i++) if (modifiers[i].kind === "Decorator") { trailing = i; break; }
            if (trailing >= 0) err(modifiers[trailing], 8038);
          }
        }
      }
    }
  }

  function checkJSSyntax(node) {
    if (!(node.flags & GOF.JavaScriptFile) || (node.flags & (GOF.JSDoc | GOF.Reparsed))) return;
    switch (node.kind) {
      case "Parameter": case "PropertyDeclaration": case "MethodDeclaration": {
        const token = node.kind === "Parameter" ? get(node, "QuestionToken") : get(node, "PostfixToken");
        if (token && !isReparsed(token) && token.kind === "QuestionToken") err(token, 8009, "?");
      }
      // falls through
      case "MethodSignature": case "Constructor": case "GetAccessor": case "SetAccessor": case "FunctionExpression": case "FunctionDeclaration": case "ArrowFunction": case "VariableDeclaration": case "IndexSignature": {
        const t = get(node, "Type");
        if (FUNCTION_LIKE.has(node.kind) && !get(node, "Body")) err(node, 8017);
        else if (t && !isReparsed(t)) err(t, 8010);
        break;
      }
      case "ImportDeclaration": { const c = get(node, "ImportClause"); if (c && c.scalars.get("PhaseModifier")?.k === "TypeKeyword") err(node, 8006, "import type"); break; }
      case "ExportDeclaration": if (node.scalars.get("IsTypeOnly")?.b) err(node, 8006, "export type"); break;
      case "ImportSpecifier": if (node.scalars.get("IsTypeOnly")?.b) err(node, 8006, "import...type"); break;
      case "ExportSpecifier": if (node.scalars.get("IsTypeOnly")?.b) err(node, 8006, "export...type"); break;
      case "ImportEqualsDeclaration": err(node, 8002); break;
      case "ExportAssignment": if (node.scalars.get("IsExportEquals")?.b) err(node, 8003); break;
      case "HeritageClause": if (node.scalars.get("Token")?.k === "ImplementsKeyword") err(node, 8005); break;
      case "InterfaceDeclaration": err(get(node, "name"), 8006, "interface"); break;
      case "ModuleDeclaration": err(get(node, "name"), 8006, KEYWORD_TEXT[node.scalars.get("Keyword")?.k] ?? "?"); break;
      case "TypeAliasDeclaration": err(get(node, "name"), 8008); break;
      case "EnumDeclaration": err(get(node, "name"), 8006, "enum"); break;
      case "NonNullExpression": err(node, 8013); break;
      case "AsExpression": err(get(node, "Type"), 8016); break;
      case "SatisfiesExpression": err(get(node, "Type"), 8037); break;
    }
    checkJSDecoratorSyntax(node);
    switch (node.kind) {
      case "ClassDeclaration": case "ClassExpression": case "MethodDeclaration": case "Constructor": case "GetAccessor": case "SetAccessor": case "FunctionExpression": case "FunctionDeclaration": case "ArrowFunction": {
        const list = get(node, "TypeParameters");
        if (list && list.nodes.some(n => !isReparsed(n))) err(list, 8004);
      }
      // falls through
      case "VariableStatement": case "PropertyDeclaration":
        for (const m of nodesOf(node, "modifiers")) if (!isReparsed(m) && m.kind !== "Decorator" && !JS_MODIFIERS.has(m.kind)) err(m, 8009, MODIFIER_TEXT[m.kind] ?? m.kind);
        break;
      case "Parameter":
        if (nodesOf(node, "modifiers").some(m => m.kind !== "Decorator")) err(get(node, "modifiers"), 8012);
        break;
      case "CallExpression": case "NewExpression": case "ExpressionWithTypeArguments": case "JsxSelfClosingElement": case "JsxOpeningElement": case "TaggedTemplateExpression": {
        const list = get(node, "TypeArguments");
        if (list && list.nodes.some(n => !isReparsed(n))) err(list, 8011);
        break;
      }
    }
  }

  const isSimpleArrow = n => {
    if (nodesOf(n, "Parameters").length !== 1) return false;
    const mods = get(n, "modifiers");
    const p = skipTrivia(textBytes, mods && mods.nodes.length ? mods.end : n.pos);
    return textBytes[p] !== 0x28 && textBytes[p] !== 0x3c;
  };
  const TYPE_MEMBER_OWNERS = new Set(["TypeLiteral", "InterfaceDeclaration", "MappedType"]);
  const PARAMETER_OWNERS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunction", "MethodDeclaration", "Constructor", "GetAccessor", "SetAccessor"]);
  // The calls of the parser, at the point where each node is finished.
  (function walk(n, parent, grand) {
    const kids = [];
    for (const c of n.children.values()) { if (c.list) kids.push(...c.nodes); else kids.push(c); }
    kids.sort((a, b) => a.pos - b.pos || a.end - b.end);
    for (const c of kids) walk(c, n, parent);
    switch (n.kind) {
      case "VariableStatement": case "VariableDeclaration": case "FunctionDeclaration": case "HeritageClause": case "Constructor": case "MethodDeclaration": case "PropertyDeclaration":
      case "InterfaceDeclaration": case "TypeAliasDeclaration": case "EnumDeclaration": case "ImportEqualsDeclaration": case "ImportDeclaration": case "ImportSpecifier":
      case "ExportAssignment": case "ExportDeclaration": case "ExportSpecifier": case "NonNullExpression": case "CallExpression": case "TaggedTemplateExpression": case "FunctionExpression": case "NewExpression":
        checkJSSyntax(n); break;
      case "ModuleDeclaration":
        // An ambient module declaration with a string name is not checked.
        if (get(n, "name")?.kind !== "StringLiteral" && n.scalars.get("Keyword")?.k !== "GlobalKeyword") checkJSSyntax(n);
        break;
      case "ClassDeclaration": case "ClassExpression":
        checkJSSyntax(n);
        for (const clause of nodesOf(n, "HeritageClauses")) if (clause.scalars.get("Token")?.k === "ExtendsKeyword") for (const e of nodesOf(clause, "Types")) checkJSSyntax(e);
        break;
      case "IndexSignature":
        if (parent?.kind === "ClassDeclaration" || parent?.kind === "ClassExpression") checkJSSyntax(n);
        break;
      case "GetAccessor": case "SetAccessor":
        if (!TYPE_MEMBER_OWNERS.has(parent?.kind)) checkJSSyntax(n);
        break;
      case "Parameter":
        if (PARAMETER_OWNERS.has(parent?.kind) && !((parent.kind === "GetAccessor" || parent.kind === "SetAccessor") && TYPE_MEMBER_OWNERS.has(grand?.kind)) && !(parent.kind === "ArrowFunction" && isSimpleArrow(parent))) checkJSSyntax(n);
        break;
      case "ArrowFunction":
        if (!isSimpleArrow(n)) checkJSSyntax(n);
        break;
      case "AsExpression": case "SatisfiesExpression":
        // A cast that the reparser made from @type or @satisfies is not checked.
        if (!isReparsed(get(n, "Type"))) checkJSSyntax(n);
        break;
    }
  })(root, null, null);
  return out;
}
