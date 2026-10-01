// Probe: a port of checkJSSyntax and checkJSDecoratorSyntax (typescript-go internal/parser/parser.go:6707-6850)
// as a pass over a finished tree. Produces [pos, end, code] in the order in which the parser reports.
import { GOF } from "./convert.mjs";
import { byKind } from "./gotable.mjs";

const C = (n, name) => n?.children.get(name);
const FUNCTION_LIKE = new Set(["MethodSignature", "CallSignature", "JSDocSignature", "ConstructSignature", "IndexSignature", "FunctionType", "ConstructorType",
  "FunctionDeclaration", "MethodDeclaration", "Constructor", "GetAccessor", "SetAccessor", "FunctionExpression", "ArrowFunction"]);
const ILLEGAL_DECORATORS = new Set(["PropertyAssignment", "ShorthandPropertyAssignment", "FunctionDeclaration", "Constructor", "IndexSignature", "ClassStaticBlockDeclaration",
  "MissingDeclaration", "VariableStatement", "InterfaceDeclaration", "TypeAliasDeclaration", "EnumDeclaration", "ModuleDeclaration", "ImportEqualsDeclaration",
  "ImportDeclaration", "JSImportDeclaration", "NamespaceExportDeclaration", "ExportDeclaration", "ExportAssignment"]);
const CAN_DECORATE = new Set(["Parameter", "PropertyDeclaration", "MethodDeclaration", "GetAccessor", "SetAccessor", "ClassExpression", "ClassDeclaration"]);
const JS_MODIFIERS = new Set(["ExportKeyword", "StaticKeyword", "AccessorKeyword", "AsyncKeyword", "DefaultKeyword"]);
const MODIFIER_KINDS = new Set(["AbstractKeyword", "AccessorKeyword", "AsyncKeyword", "ConstKeyword", "DeclareKeyword", "DefaultKeyword", "ExportKeyword", "InKeyword",
  "PublicKeyword", "PrivateKeyword", "ProtectedKeyword", "ReadonlyKeyword", "StaticKeyword", "OutKeyword", "OverrideKeyword"]);
const TYPE_MEMBER_PARENTS = new Set(["TypeLiteral", "InterfaceDeclaration", "MappedType"]);

// scanner.SkipTrivia over UTF-8 bytes: white space, line breaks, comments, a shebang at 0 and conflict markers are not modelled beyond comments.
export function skipTrivia(b, pos) {
  if (pos < 0) return pos;
  for (;;) {
    const ch = b[pos];
    if (ch === undefined) return pos;
    if (ch === 0x0d || ch === 0x0a || ch === 0x09 || ch === 0x0b || ch === 0x0c || ch === 0x20) { pos++; continue; }
    if (ch === 0x2f) {
      if (b[pos + 1] === 0x2f) { pos += 2; while (pos < b.length && b[pos] !== 0x0a && b[pos] !== 0x0d && !(b[pos] === 0xe2 && b[pos + 1] === 0x80 && (b[pos + 2] === 0xa8 || b[pos + 2] === 0xa9))) pos++; continue; }
      if (b[pos + 1] === 0x2a) { pos += 2; while (pos < b.length && !(b[pos] === 0x2a && b[pos + 1] === 0x2f)) pos++; pos = Math.min(pos + 2, b.length); continue; }
      return pos;
    }
    if (ch === 0xc2 && (b[pos + 1] === 0xa0 || b[pos + 1] === 0x85)) { pos += 2; continue; }
    if (ch === 0xe2 && b[pos + 1] === 0x80 && ((b[pos + 2] >= 0x80 && b[pos + 2] <= 0x8b) || b[pos + 2] === 0xa8 || b[pos + 2] === 0xa9 || b[pos + 2] === 0xaf)) { pos += 3; continue; }
    if (ch === 0xe1 && b[pos + 1] === 0x9a && b[pos + 2] === 0x80) { pos += 3; continue; }
    if (ch === 0xe2 && b[pos + 1] === 0x81 && b[pos + 2] === 0x9f) { pos += 3; continue; }
    if (ch === 0xe3 && b[pos + 1] === 0x80 && b[pos + 2] === 0x80) { pos += 3; continue; }
    if (ch === 0xef && b[pos + 1] === 0xbb && b[pos + 2] === 0xbf) { pos += 3; continue; }
    if (pos === 0 && ch === 0x23 && b[1] === 0x21) { while (pos < b.length && b[pos] !== 0x0a && b[pos] !== 0x0d) pos++; continue; }
    return pos;
  }
}

export function checkJS(root, textBytes) {
  const out = [];
  const err = (pos, end, code, related) => out.push(related ? [skipTrivia(textBytes, pos), end, code, related] : [skipTrivia(textBytes, pos), end, code]);
  const mods = n => C(n, "modifiers")?.nodes ?? [];
  function decorators(node) {
    const modifiers = mods(node);
    if (modifiers.length === 0) return;
    if (ILLEGAL_DECORATORS.has(node.kind)) {
      const d = modifiers.find(m => m.kind === "Decorator");
      if (d) err(d.pos, d.end, 1206);
    } else if (CAN_DECORATE.has(node.kind)) {
      const decoratorIndex = modifiers.findIndex(m => m.kind === "Decorator");
      if (decoratorIndex >= 0 && node.kind === "ClassDeclaration") {
        const exportIndex = modifiers.findIndex(m => m.kind === "ExportKeyword");
        if (exportIndex >= 0) {
          const defaultIndex = modifiers.findIndex(m => m.kind === "DefaultKeyword");
          if (decoratorIndex > exportIndex && defaultIndex >= 0 && decoratorIndex < defaultIndex) err(modifiers[decoratorIndex].pos, modifiers[decoratorIndex].end, 1206);
          else if (decoratorIndex < exportIndex) {
            let trailing = -1;
            for (let i = exportIndex; i < modifiers.length; i++) if (modifiers[i].kind === "Decorator") { trailing = i; break; }
            if (trailing >= 0) err(modifiers[trailing].pos, modifiers[trailing].end, 8038, [skipTrivia(textBytes, modifiers[decoratorIndex].pos), modifiers[decoratorIndex].end, 1486]);
          }
        }
      }
    }
  }
  function check(node) {
    if (!(node.flags & GOF.JavaScriptFile) || node.flags & (GOF.JSDoc | GOF.Reparsed)) return;
    switch (node.kind) {
      case "Parameter": case "PropertyDeclaration": case "MethodDeclaration": {
        const token = node.kind === "Parameter" ? C(node, "QuestionToken") : C(node, "PostfixToken");
        if (token && !(token.flags & GOF.Reparsed) && token.kind === "QuestionToken") err(token.pos, token.end, 8009);
      }
      // falls through
      case "MethodSignature": case "Constructor": case "GetAccessor": case "SetAccessor": case "FunctionExpression": case "FunctionDeclaration": case "ArrowFunction":
      case "VariableDeclaration": case "IndexSignature": {
        const t = C(node, "Type");
        if (FUNCTION_LIKE.has(node.kind) && !C(node, "Body")) err(node.pos, node.end, 8017);
        else if (t && !(t.flags & GOF.Reparsed)) err(t.pos, t.end, 8010);
        break;
      }
      case "ImportDeclaration": { const c = C(node, "ImportClause"); if (c && c.scalars.get("PhaseModifier")?.k === "TypeKeyword") err(node.pos, node.end, 8006); break; }
      case "ExportDeclaration": case "ImportSpecifier": case "ExportSpecifier": if (node.scalars.get("IsTypeOnly")?.b) err(node.pos, node.end, 8006); break;
      case "ImportEqualsDeclaration": err(node.pos, node.end, 8002); break;
      case "ExportAssignment": if (node.scalars.get("IsExportEquals")?.b) err(node.pos, node.end, 8003); break;
      case "HeritageClause": if (node.scalars.get("Token")?.k === "ImplementsKeyword") err(node.pos, node.end, 8005); break;
      case "InterfaceDeclaration": case "ModuleDeclaration": case "EnumDeclaration": { const nm = C(node, "name"); err(nm.pos, nm.end, 8006); break; }
      case "TypeAliasDeclaration": { const nm = C(node, "name"); err(nm.pos, nm.end, 8008); break; }
      case "NonNullExpression": err(node.pos, node.end, 8013); break;
      case "AsExpression": { const t = C(node, "Type"); err(t.pos, t.end, 8016); break; }
      case "SatisfiesExpression": { const t = C(node, "Type"); err(t.pos, t.end, 8037); break; }
    }
    decorators(node);
    switch (node.kind) {
      case "ClassDeclaration": case "ClassExpression": case "MethodDeclaration": case "Constructor": case "GetAccessor": case "SetAccessor": case "FunctionExpression":
      case "FunctionDeclaration": case "ArrowFunction": {
        const list = C(node, "TypeParameters");
        if (list && list.nodes.some(n => !(n.flags & GOF.Reparsed))) err(list.pos, list.end, 8004);
      }
      // falls through
      case "VariableStatement": case "PropertyDeclaration":
        for (const m of mods(node)) if (!(m.flags & GOF.Reparsed) && m.kind !== "Decorator" && !JS_MODIFIERS.has(m.kind)) err(m.pos, m.end, 8009);
        break;
      case "Parameter":
        if (mods(node).some(m => MODIFIER_KINDS.has(m.kind))) { const l = C(node, "modifiers"); err(l.pos, l.end, 8012); }
        break;
      case "CallExpression": case "NewExpression": case "ExpressionWithTypeArguments": case "JsxSelfClosingElement": case "JsxOpeningElement": case "TaggedTemplateExpression": {
        const list = C(node, "TypeArguments");
        if (list && list.nodes.some(n => !(n.flags & GOF.Reparsed))) err(list.pos, list.end, 8011);
      }
    }
  }
  // The nodes that the parser passes to checkJSSyntax, by the call sites.
  function isSite(n, parent) {
    switch (n.kind) {
      case "VariableStatement": case "VariableDeclaration": case "FunctionDeclaration": case "ClassDeclaration": case "ClassExpression": case "HeritageClause":
      case "Constructor": case "MethodDeclaration": case "PropertyDeclaration": case "InterfaceDeclaration": case "TypeAliasDeclaration": case "EnumDeclaration":
      case "ImportEqualsDeclaration": case "ImportDeclaration": case "ImportSpecifier": case "ExportAssignment": case "ExportDeclaration": case "ExportSpecifier":
      case "ArrowFunction": case "NonNullExpression": case "CallExpression": case "TaggedTemplateExpression":
      case "FunctionExpression": case "NewExpression":
        return true;
      // A cast that the reparser made is never passed to checkJSSyntax; its type is a reparsed clone.
      case "SatisfiesExpression": case "AsExpression": return !(C(n, "Type").flags & GOF.Reparsed);
      case "ModuleDeclaration": return C(n, "name")?.kind === "Identifier" && n.scalars.get("Keyword")?.k !== "GlobalKeyword";
      case "IndexSignature": return parent?.kind === "ClassDeclaration" || parent?.kind === "ClassExpression";
      case "GetAccessor": case "SetAccessor": return !TYPE_MEMBER_PARENTS.has(parent?.kind);
      case "Parameter":
        return ["FunctionDeclaration", "FunctionExpression", "ArrowFunction", "MethodDeclaration", "Constructor"].includes(parent?.kind) ||
          ((parent?.kind === "GetAccessor" || parent?.kind === "SetAccessor") && !TYPE_MEMBER_PARENTS.has(parent.parent?.kind));
    }
    return false;
  }
  function ordered(n) {
    const order = byKind.get(n.kind)?.memberOrder ?? [];
    const e = [...n.children.entries()].map(([name, c], i) => ({ c, pos: c.list ? (c.nodes.length ? c.nodes[0].pos : c.pos) : c.pos, rank: order.indexOf(name) < 0 ? 1000 + i : order.indexOf(name) }));
    e.sort((a, b) => a.pos - b.pos || a.rank - b.rank);
    return e.map(x => x.c);
  }
  function walk(n, parent) {
    if (n.flags & GOF.Reparsed) return;
    for (const c of ordered(n)) { if (c.list) for (const x of c.nodes) walk(x, n); else walk(c, n); }
    if (isSite(n, parent)) check(n);
    if ((n.kind === "ClassDeclaration" || n.kind === "ClassExpression") && n.flags & GOF.JavaScriptFile) {
      for (const clause of C(n, "HeritageClauses")?.nodes ?? []) {
        if (clause.flags & GOF.Reparsed) continue;
        if (clause.scalars.get("Token")?.k === "ExtendsKeyword") for (const e of C(clause, "Types").nodes) check(e);
      }
    }
  }
  walk(root, undefined);
  return out;
}
