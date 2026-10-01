// Probe: the importer side. Turns the flat dump into typescript-go's tree shape and prints it like /tmp/rr/dumpast.
import { goKindIndex, byKind } from "./gotable.mjs";
import { reparse, setParents } from "./reparse.mjs";

export const ruleHits = new Map();
const hit = r => ruleHits.set(r, (ruleHits.get(r) ?? 0) + 1);

const KIND_RENAME = { EndOfFileToken: "EndOfFile", JSDocTag: "JSDocUnknownTag", JSDocAuthorTag: "JSDocUnknownTag", JSDocClassTag: "JSDocUnknownTag",
  JSDocEnumTag: "JSDocUnknownTag", JSDocMemberName: "QualifiedName" };
// TypeScript NodeFlags bit -> typescript-go NodeFlags bit, for the flags a parse can set.
const TSF = { Let: 1 << 0, Const: 1 << 1, Using: 1 << 2, NestedNamespace: 1 << 3, Synthesized: 1 << 4, Namespace: 1 << 5, OptionalChain: 1 << 6,
  ExportContext: 1 << 7, ContainsThis: 1 << 8, HasImplicitReturn: 1 << 9, HasExplicitReturn: 1 << 10, GlobalAugmentation: 1 << 11, HasAsyncFunctions: 1 << 12,
  DisallowInContext: 1 << 13, YieldContext: 1 << 14, DecoratorContext: 1 << 15, AwaitContext: 1 << 16, DisallowConditionalTypesContext: 1 << 17,
  ThisNodeHasError: 1 << 18, JavaScriptFile: 1 << 19, ThisNodeOrAnySubNodesHasError: 1 << 20, HasAggregatedChildData: 1 << 21,
  PossiblyContainsDynamicImport: 1 << 22, PossiblyContainsImportMeta: 1 << 23, JSDoc: 1 << 24, Ambient: 1 << 25, InWithStatement: 1 << 26, JsonFile: 1 << 27,
  TypeCached: 1 << 28, Deprecated: 1 << 29, Unreachable: 1 << 30 };
export const GOF = { Let: 1 << 0, Const: 1 << 1, Using: 1 << 2, Reparsed: 1 << 3, Synthesized: 1 << 4, OptionalChain: 1 << 5, ExportContext: 1 << 6, ContainsThis: 1 << 7,
  HasImplicitReturn: 1 << 8, HasExplicitReturn: 1 << 9, DisallowInContext: 1 << 10, YieldContext: 1 << 11, DecoratorContext: 1 << 12, AwaitContext: 1 << 13,
  DisallowConditionalTypesContext: 1 << 14, ThisNodeHasError: 1 << 15, JavaScriptFile: 1 << 16, ThisNodeOrAnySubNodesHasError: 1 << 17, HasAsyncFunctions: 1 << 18,
  PossiblyContainsDynamicImport: 1 << 19, PossiblyContainsImportMeta: 1 << 20, HasJSDoc: 1 << 21, JSDoc: 1 << 22, Ambient: 1 << 23, InWithStatement: 1 << 24,
  JsonFile: 1 << 25, PossiblyContainsDeprecatedTag: 1 << 26, Unreachable: 1 << 27, ReparserTransformedLiteral: 1 << 28 };
const FLAG_MAP = [["Let", "Let"], ["Const", "Const"], ["Using", "Using"], ["OptionalChain", "OptionalChain"],
  ["DisallowInContext", "DisallowInContext"], ["YieldContext", "YieldContext"], ["DecoratorContext", "DecoratorContext"],
  ["AwaitContext", "AwaitContext"], ["DisallowConditionalTypesContext", "DisallowConditionalTypesContext"], ["ThisNodeHasError", "ThisNodeHasError"],
  ["JavaScriptFile", "JavaScriptFile"], ["PossiblyContainsDynamicImport", "PossiblyContainsDynamicImport"], ["PossiblyContainsImportMeta", "PossiblyContainsImportMeta"],
  ["JSDoc", "JSDoc"], ["Ambient", "Ambient"], ["InWithStatement", "InWithStatement"], ["JsonFile", "JsonFile"]].map(([a, b]) => [TSF[a], GOF[b]]);

function convertFlags(f) {
  let out = 0;
  for (const [a, b] of FLAG_MAP) if (f & a) out |= b;
  return out >>> 0;
}

const PROP_RENAME = {
  TypeParameter: { default: "DefaultType" },
  ImportAttributes: { elements: "Attributes" },
  JSDocAugmentsTag: { class: "ClassName" },
  JSDocImplementsTag: { class: "ClassName" },
  JSDocTypedefTag: { fullName: "name", name: null },
  JSDocCallbackTag: { fullName: "name", name: null },
  JSDocSeeTag: { name: "NameExpression" },
  JSDocTypeLiteral: { jsDocPropertyTags: "JSDocPropertyTags" },
};
const JSDOC_TAG_KINDS = new Set(["JSDocTypeTag", "JSDocUnknownTag", "JSDocTemplateTag", "JSDocReturnTag", "JSDocPublicTag", "JSDocPrivateTag", "JSDocProtectedTag",
  "JSDocReadonlyTag", "JSDocOverrideTag", "JSDocDeprecatedTag", "JSDocSeeTag", "JSDocImplementsTag", "JSDocAugmentsTag", "JSDocSatisfiesTag", "JSDocThrowsTag",
  "JSDocThisTag", "JSDocImportTag", "JSDocCallbackTag", "JSDocOverloadTag", "JSDocTypedefTag", "JSDocParameterTag", "JSDocPropertyTag"]);
const KIND_FIELDS = [["token", "Token"], ["operator", "Operator"], ["keywordToken", "KeywordToken"], ["phaseModifier", "PhaseModifier"]];
const BOOL_FIELDS = [["multiLine", "MultiLine"], ["isTypeOnly", "IsTypeOnly"], ["isExportEquals", "IsExportEquals"], ["isTypeOf", "IsTypeOf"],
  ["containsOnlyTriviaWhiteSpaces", "ContainsOnlyTriviaWhiteSpaces"], ["isArrayType", "IsArrayType"], ["isBracketed", "IsBracketed"], ["isNameFirst", "IsNameFirst"]];

const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);
const propMapCache = new Map();
function propMap(goKind) {
  let m = propMapCache.get(goKind);
  if (m) return m;
  m = new Map();
  const e = byKind.get(goKind);
  if (e) for (const [name, f] of e.fields) if (!f.goOnly) m.set(lowerFirst(name), name);
  for (const [k, v] of Object.entries(PROP_RENAME[goKind] ?? {})) { if (v === null) m.delete(k); else m.set(k, v); }
  propMapCache.set(goKind, m);
  return m;
}
const fieldsOf = goKind => byKind.get(goKind)?.fields ?? new Map();

// Step 1: the flat records become objects that still have TypeScript's names.
export function inflate(bundle, d) {
  d = { ...d, kinds: bundle.kinds, props: bundle.props, strings: bundle.strings };
  const n = d.nodes.length / 8;
  const nodes = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 8;
    nodes[i] = { i, tsKind: d.kinds[d.nodes[o]], pos: d.nodes[o + 1], end: d.nodes[o + 2], tsFlags: d.nodes[o + 3], parentIdx: d.nodes[o + 4],
      prop: d.props[d.nodes[o + 5]], listIdx: d.nodes[o + 6], jsdocInfo: d.nodes[o + 7], props: new Map(), attrs: new Map(), jsDoc: [] };
  }
  const lists = [];
  for (let i = 0; i < d.lists.length; i += 5) {
    const l = { list: true, owner: d.lists[i], prop: d.props[d.lists[i + 1]], pos: d.lists[i + 2], end: d.lists[i + 3], hasTrailingComma: d.lists[i + 4] === 1, nodes: [] };
    lists.push(l);
    nodes[l.owner].props.set(l.prop, l);
  }
  for (let i = 1; i < n; i++) {
    const c = nodes[i], par = nodes[c.parentIdx];
    c.parent = par;
    if (c.prop === "jsDoc") par.jsDoc.push(c);
    else if (c.listIdx >= 0) lists[c.listIdx].nodes.push(c);
    else par.props.set(c.prop, c);
  }
  for (let i = 0; i < d.attrs.length; i += 4) {
    const node = nodes[d.attrs[i]], key = d.props[d.attrs[i + 1]], type = d.attrs[i + 2], v = d.attrs[i + 3];
    node.attrs.set(key, type === 0 ? true : type === 1 ? d.kinds[v] : type === 2 ? d.strings[v] : v);
  }
  return nodes[0];
}

const goKindOf = tsKind => KIND_RENAME[tsKind] ?? tsKind;
const TYPE_HERITAGE_OK = n => (n.tsKind === "Identifier" ? n.pos !== n.end || (n.attrs.get("text") ?? "") !== "" : n.tsKind === "PropertyAccessExpression" && !(n.tsFlags & TSF.OptionalChain) && TYPE_HERITAGE_OK(n.props.get("name")) && TYPE_HERITAGE_OK(n.props.get("expression")));

export function mk(kind, pos, end, flags) { return { kind, pos, end, flags: flags >>> 0, scalars: new Map(), children: new Map(), jsdoc: [] }; }

// Step 2: one node of TypeScript becomes one node of typescript-go's shape; the named rules are the differences.
export function convert(n, ctx) {
  let goKind = goKindOf(n.tsKind);
  // Rule omitted-binding-element
  if (n.tsKind === "OmittedExpression" && n.parent?.tsKind === "ArrayBindingPattern") { goKind = "BindingElement"; hit("omitted-binding-element"); }
  const out = mk(goKind, n.pos, n.end, convertFlags(n.tsFlags));
  // Rule identifier-flags: the two flags TypeScript reuses on identifiers.
  if (n.tsKind === "Identifier" && n.tsFlags & TSF.HasAsyncFunctions) out.flags = (out.flags | GOF.HasAsyncFunctions) >>> 0;
  if (!goKindIndex.has(goKind)) hit("kind-only-in-ts:" + goKind);
  const fields = fieldsOf(goKind);
  const pm = propMap(goKind);

  for (const [key, v] of n.props) {
    if (key === "comment" && (goKind === "JSDoc" || JSDOC_TAG_KINDS.has(goKind))) continue;
    if (key === "typeExpression" && n.tsKind === "JSDocEnumTag") continue;
    if ((key === "questionToken" || key === "exclamationToken") && fields.has("PostfixToken")) { out.children.set("PostfixToken", convert(v, ctx)); hit("postfix-token"); continue; }
    const goField = pm.get(key);
    if (!goField) { hit(`ts-only-child:${goKind}.${key}`); continue; }
    if (v.list) {
      const l = { list: true, pos: v.pos, end: v.end, nodes: v.nodes.map(c => convert(c, ctx)) };
      if (goField === "modifiers") { l.modifiers = true; l.modifierFlags = modifiersToFlags(l.nodes); }
      out.children.set(goField, l);
    } else out.children.set(goField, convert(v, ctx));
  }

  for (const [tsKey, goField] of KIND_FIELDS) if (fields.has(goField)) { const v = n.attrs.get(tsKey); out.scalars.set(goField, { k: v === undefined ? "Unknown" : goKindOf(v) }); }
  for (const [tsKey, goField] of BOOL_FIELDS) if (fields.has(goField) && n.attrs.get(tsKey)) out.scalars.set(goField, { b: true });
  if (fields.has("Text")) {
    if (n.attrs.has("text")) out.scalars.set("Text", { s: n.attrs.get("text") });
    else out.scalars.set("Text", { s: "" });
  }
  if (fields.has("RawText")) out.scalars.set("RawText", { s: goKind === "NoSubstitutionTemplateLiteral" ? "" : (n.attrs.get("rawText") ?? "") });
  if (fields.has("TokenFlags")) out.scalars.set("TokenFlags", { x: tokenFlags(n, goKind, ctx) });
  if (fields.has("TemplateFlags")) out.scalars.set("TemplateFlags", { x: invalidUnicodeEscape((n.attrs.get("templateFlags") ?? 0) | (n.attrs.get("isUnterminated") ? 1 << 2 : 0), n, ctx) & TF_TEMPLATE });
  // Rule element-access-error-flag: the error of `a[]` is on the element access, not on the missing argument.
  if (goKind === "ElementAccessExpression") {
    const a = out.children.get("ArgumentExpression");
    if (a && a.kind === "Identifier" && a.pos === a.end && a.scalars.get("Text")?.s === "" && a.flags & GOF.ThisNodeHasError) {
      hit("element-access-error-flag");
      a.flags = (a.flags & ~GOF.ThisNodeHasError) >>> 0;
      out.flags = (out.flags | GOF.ThisNodeHasError) >>> 0;
    }
  }
  // Rule assert-keyword-error-flag: `assert` is a parse error in typescript-go; the next finished node has the flag.
  if (goKind === "ImportAttributes" && n.attrs.get("token") === "AssertKeyword") {
    hit("assert-keyword-error-flag");
    const first = out.children.get("Attributes")?.nodes[0];
    const target = first ? (first.children.get("name") ?? first) : out;
    target.flags = (target.flags | GOF.ThisNodeHasError) >>> 0;
  }

  // Rule module-keyword and rule nested-namespace
  if (goKind === "ModuleDeclaration" && n.tsFlags & TSF.JSDoc) {
    // Rule jsdoc-namespace: the dotted name of a typedef or callback tag is a chain of namespace declarations.
    hit("jsdoc-namespace");
    out.scalars.set("Keyword", { k: "NamespaceKeyword" });
    out.flags = (n.tsFlags & TSF.NestedNamespace ? out.flags | GOF.OptionalChain : out.flags & ~GOF.OptionalChain) >>> 0;
  } else if (goKind === "ModuleDeclaration") {
    out.scalars.set("Keyword", { k: n.tsFlags & TSF.GlobalAugmentation ? "GlobalKeyword" : n.tsFlags & TSF.Namespace ? "NamespaceKeyword" : "ModuleKeyword" });
    out.flags = (out.flags & ~GOF.OptionalChain) >>> 0;
    if (n.tsFlags & TSF.NestedNamespace) {
      hit("nested-namespace");
      const m = mk("ExportKeyword", n.pos, n.pos, GOF.Reparsed);
      out.children.set("modifiers", { list: true, modifiers: true, modifierFlags: 1 << 5, pos: n.pos, end: n.pos, nodes: [m] });
    }
  }
  // Rule heritage-type-reference
  if (goKind === "HeritageClause") {
    const isInterface = n.parent?.tsKind === "InterfaceDeclaration";
    const token = n.attrs.get("token");
    if ((isInterface && token === "ExtendsKeyword") || (!isInterface && token === "ImplementsKeyword")) {
      const tsTypes = n.props.get("types"), goTypes = out.children.get("Types");
      tsTypes.nodes.forEach((t, i) => {
        if (t.tsKind !== "ExpressionWithTypeArguments" || !TYPE_HERITAGE_OK(t.props.get("expression"))) return;
        hit("heritage-type-reference");
        const g = goTypes.nodes[i];
        const r = mk("TypeReference", g.pos, g.end, g.flags);
        r.children.set("TypeName", entityName(g.children.get("Expression")));
        if (g.children.has("TypeArguments")) r.children.set("TypeArguments", g.children.get("TypeArguments"));
        r.jsdoc = g.jsdoc;
        goTypes.nodes[i] = r;
      });
    }
  }
  // Rule jsdoc-comment: a comment is always a list of JSDocText and link nodes.
  if (goKind === "JSDoc" || JSDOC_TAG_KINDS.has(goKind)) {
    const c = n.props.get("comment");
    const str = n.attrs.get("comment");
    // The comment of a JSDoc node ends where its first tag starts, or before the closing of the comment.
    const tags = n.props.get("tags");
    const cpos = n.pos, cend = goKind === "JSDoc" ? (tags ? tags.pos : n.end - 2) : n.end;
    if (c && c.list) out.children.set("Comment", { list: true, comment: true, pos: c.pos, end: c.end, nodes: c.nodes.map(x => convert(x, ctx)) });
    else if (typeof str === "string" || n.tsKind === "JSDocEnumTag" || n.tsKind === "JSDocAuthorTag") {
      const t = mk("JSDocText", cpos, cend, out.flags);
      t.scalars.set("text", { s: str ?? "" });
      t.approximate = goKind !== "JSDoc";
      out.children.set("Comment", { list: true, comment: true, approximate: goKind !== "JSDoc", pos: cpos, end: cend, nodes: [t] });
    } else if (goKind === "JSDoc") out.children.set("Comment", { list: true, comment: true, pos: cpos, end: cend, nodes: [] });
  }
  if (goKind === "JSDocText" || goKind === "JSDocLink" || goKind === "JSDocLinkCode" || goKind === "JSDocLinkPlain") out.scalars.set("text", { s: n.attrs.get("text") ?? "" });
  if (goKind === "JSDocTypeLiteral" && out.children.has("JSDocPropertyTags")) { const l = out.children.get("JSDocPropertyTags"); l.raw = true; l.pos = -1; l.end = -1; }
  // Rule callback-signature-pos: the signature of a callback tag starts where its parameters start.
  if (goKind === "JSDocCallbackTag") {
    const sig = out.children.get("TypeExpression");
    const ps = sig?.children.get("Parameters");
    if (sig && ps) { sig.pos = ps.pos; hit("callback-signature-pos"); }
  }
  // Rule template-type-parameters-range: the list of a template tag has no range.
  if (goKind === "JSDocTemplateTag") {
    const l = out.children.get("TypeParameters");
    if (l) { l.pos = 0; l.end = 0; hit("template-type-parameters-range"); }
  }
  // Rule typedef-type-literal-pos: the type literal of a typedef starts at its first property tag.
  if (goKind === "JSDocTypedefTag") {
    const lit = out.children.get("TypeExpression");
    if (lit && lit.kind === "JSDocTypeLiteral") {
      const first = lit.children.get("JSDocPropertyTags")?.nodes[0];
      if (first) { lit.pos = first.pos; hit("typedef-type-literal-pos"); }
    }
  }
  // Rule jsdoc-unknown-type: `?` alone is a nullable type of a missing type reference.
  if (n.tsKind === "JSDocUnknownType") {
    hit("jsdoc-unknown-type");
    out.kind = "JSDocNullableType";
    const ref = mk("TypeReference", n.end, n.end, out.flags);
    const id = mk("Identifier", n.end, n.end, (out.flags | GOF.ThisNodeHasError) >>> 0);
    id.scalars.set("Text", { s: "" });
    ref.children.set("TypeName", id);
    out.children.set("Type", ref);
  }
  // Rule jsdoc-missing-name: a typedef or callback tag without a name has a missing identifier.
  if ((goKind === "JSDocTypedefTag" || goKind === "JSDocCallbackTag") && !out.children.has("name")) {
    hit("jsdoc-missing-name");
    const id = mk("Identifier", n.end, n.end, (out.flags | GOF.ThisNodeHasError) >>> 0);
    id.scalars.set("Text", { s: "" });
    out.children.set("name", id);
  }
  // Rule jsdoc-flags
  if (ctx.isJS) {
    // In a JavaScript file the flags follow the parsed comments: a comment that is attached, a deprecated tag that was parsed.
    if (n.jsDoc.length) out.flags = (out.flags | GOF.HasJSDoc) >>> 0;
    if (n.jsDoc.some(hasDeprecatedTag)) out.flags = (out.flags | GOF.PossiblyContainsDeprecatedTag) >>> 0;
  } else {
    if (n.jsdocInfo & 1) out.flags = (out.flags | GOF.HasJSDoc) >>> 0;
    if (n.jsdocInfo & 2 || (n.jsdocInfo & 4 && n.jsDoc.some(hasDeprecatedTag))) out.flags = (out.flags | GOF.PossiblyContainsDeprecatedTag) >>> 0;
  }
  // Rule jsdoc-position: a JSDoc node starts where its host starts, or where the JSDoc before it ends.
  let jpos = n.pos;
  for (const j of n.jsDoc) {
    const g = convert(j, ctx);
    g.pos = jpos; jpos = g.end;
    // Rule jsdoc-lazy-flags: a JSDoc comment that is parsed on demand does not see the context of its host.
    if (!ctx.isJS && !(n.jsdocInfo & 4)) clearFlags(g, out.flags & CONTEXT_MASK);
    out.jsdoc.push(g);
  }
  out.tsNode = n;
  return out;
}

function hasDeprecatedTag(n) {
  if (n.tsKind === "JSDocDeprecatedTag") return true;
  for (const v of n.props.values()) { if (v.list) { if (v.nodes.some(hasDeprecatedTag)) return true; } else if (hasDeprecatedTag(v)) return true; }
  return false;
}
const CONTEXT_MASK = GOF.DisallowInContext | GOF.DisallowConditionalTypesContext | GOF.YieldContext | GOF.DecoratorContext | GOF.AwaitContext | GOF.JavaScriptFile | GOF.InWithStatement | GOF.Ambient;
function clearFlags(g, mask) {
  g.flags = (g.flags & ~mask) >>> 0;
  for (const c of g.children.values()) { if (c.list) for (const x of c.nodes) clearFlags(x, mask); else clearFlags(c, mask); }
  for (const j of g.jsdoc) clearFlags(j, mask);
}
function entityName(g) {
  if (g.kind === "Identifier") return g;
  const q = mk("QualifiedName", g.pos, g.end, g.flags);
  q.children.set("Left", entityName(g.children.get("Expression")));
  q.children.set("Right", g.children.get("name"));
  return q;
}

const MOD = { PublicKeyword: 1 << 0, PrivateKeyword: 1 << 1, ProtectedKeyword: 1 << 2, ReadonlyKeyword: 1 << 3, OverrideKeyword: 1 << 4, ExportKeyword: 1 << 5,
  AbstractKeyword: 1 << 6, DeclareKeyword: 1 << 7, StaticKeyword: 1 << 8, AccessorKeyword: 1 << 9, AsyncKeyword: 1 << 10, DefaultKeyword: 1 << 11,
  ConstKeyword: 1 << 12, InKeyword: 1 << 13, OutKeyword: 1 << 14, Decorator: 1 << 15 };
export function modifiersToFlags(nodes) { let f = 0; for (const m of nodes) f |= MOD[m.kind] ?? 0; return f; }

const TF_STRING = (1 << 2) | (1 << 12) | (1 << 10) | (1 << 3) | (1 << 11) | (1 << 16);
const TF_NUMERIC = (1 << 4) | (1 << 5) | (1 << 13) | (1 << 6) | (1 << 7) | (1 << 8) | (1 << 9) | (1 << 14);
const TF_TEMPLATE = (1 << 2) | (1 << 12) | (1 << 10) | (1 << 3) | (1 << 11);
// typescript-go sets UnicodeEscape when it starts to scan \uXXXX, TypeScript when the escape was valid.
function invalidUnicodeEscape(tf, n, ctx) {
  if (!(tf & (1 << 11))) return tf;
  const tok = ctx.textBytes.subarray(n.pos, n.end);
  for (let i = 0; i + 1 < tok.length; i++) {
    if (tok[i] !== 0x5c) continue;
    i++;
    if (tok[i] === 0x75 && tok[i + 1] !== 0x7b) tf |= 1 << 10;
  }
  return tf;
}
function tokenFlags(n, goKind, ctx) {
  switch (goKind) {
    case "StringLiteral": {
      let tf = n.attrs.get("$tokenFlags") ?? 0;
      if (tf !== -1) tf = invalidUnicodeEscape(tf, n, ctx);
      if (tf === -1) { hit("string-rescan-failed"); tf = (n.attrs.get("isUnterminated") ? 1 << 2 : 0) | (n.attrs.get("hasExtendedUnicodeEscape") ? 1 << 3 : 0); }
      if (n.attrs.get("$singleQuote")) tf |= 1 << 16;
      return tf & TF_STRING;
    }
    case "NumericLiteral": return (n.attrs.get("numericLiteralFlags") ?? 0) & TF_NUMERIC;
    case "BigIntLiteral": { const tf = n.attrs.get("$tokenFlags") ?? 0; return (tf === -1 ? 0 : tf) & TF_NUMERIC; }
    case "RegularExpressionLiteral": { const tf = n.attrs.get("$tokenFlags") ?? 0; return (tf === -1 ? (n.attrs.get("isUnterminated") ? 1 << 2 : 0) : tf) & (1 << 2); }
    case "NoSubstitutionTemplateLiteral": return 0;
    default: return 0;
  }
}

// Step 3: rules that need the finished tree.
export function postprocess(root, d) {
  const emi = externalModuleIndicator(root, { isDeclarationFile: d?.isDeclarationFile, force: d?.force, jsx: d?.jsx });
  root.externalModuleIndicator = emi;
  if (emi && !d?.isDeclarationFile) {
    for (const s of root.children.get("Statements").nodes) {
      const trigger = hasAwaitIdentifier(s, true);
      if (trigger && !(s.flags & GOF.AwaitContext)) { hit("top-level-await-reparse:set"); setAwait(s, true); }
      else if (!trigger && s.flags & GOF.AwaitContext && !ALWAYS_AWAIT.has(s.kind) && tsReparsed(s)) { hit("top-level-await-reparse:clear"); setAwait(s, false); }
    }
  }
  // Rule exported-class-await-context
  (function walk(g, inBlock) {
    if (g.kind === "ClassDeclaration" && inBlock && !(g.flags & GOF.AwaitContext)) {
      const mods = g.children.get("modifiers");
      if (mods && mods.nodes.some(m => m.kind === "ExportKeyword")) {
        hit("exported-class-await-context");
        const h = g.children.get("HeritageClauses"), m = g.children.get("Members");
        if (h) for (const c of h.nodes) clearAwait(c);
        if (m) for (const c of m.nodes) clearAwait(c);
      }
    }
    const block = inBlock || g.kind === "Block" || g.kind === "ModuleBlock" || g.kind === "CaseClause" || g.kind === "DefaultClause";
    for (const c of g.children.values()) { if (c.list) for (const x of c.nodes) walk(x, block); else walk(c, block); }
  })(root, false);
  return root;
}

const FUNCTION_LIKE = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunction", "MethodDeclaration", "Constructor", "GetAccessor", "SetAccessor"]);
function clearAwait(g) { setAwait(g, false); }
function setAwait(g, on) {
  g.flags = (on ? g.flags | GOF.AwaitContext : g.flags & ~GOF.AwaitContext) >>> 0;
  const fl = FUNCTION_LIKE.has(g.kind);
  for (const [name, c] of g.children) {
    if (fl && name === "Parameters") {
      // The modifiers of a parameter are parsed in the await context around the function.
      for (const prm of c.nodes) { const m = prm.children.get("modifiers"); if (m) for (const x of m.nodes) setAwait(x, on); }
      continue;
    }
    if (fl && name === "Body") continue;
    if (g.kind === "ClassStaticBlockDeclaration" && name === "Body") continue;
    if (g.kind === "PropertyDeclaration" && name === "Initializer") continue;
    // A child that the grammar parses as a type is parsed outside of the await context.
    if (fieldsOf(g.kind).get(name)?.type === "TypeNode") continue;
    if (c.list) { for (const x of c.nodes) setAwait(x, on); } else setAwait(c, on);
  }
}

const ALWAYS_AWAIT = new Set([]);
// TypeScript reparses a statement when an identifier spelled await is anywhere but in a member name.
function tsReparsed(g) {
  if (g.kind === "Identifier") return g.scalars.get("Text")?.s === "await";
  for (const [name, c] of g.children) {
    if (c.list) { for (const x of c.nodes) if (tsReparsed(x)) return true; } else if (tsReparsed(c)) return true;
  }
  return false;
}
const BINDING_NAMED = new Set(["VariableDeclaration", "Parameter", "BindingElement", "FunctionDeclaration", "FunctionExpression", "ClassDeclaration", "ClassExpression",
  "InterfaceDeclaration", "TypeAliasDeclaration", "TypeParameter", "ImportClause", "NamespaceImport", "ImportSpecifier"]);
// Rule top-level-await-reparse (approximation of statementHasAwaitIdentifier).
const AWAIT_OPAQUE = new Set(["EnumDeclaration", "ModuleDeclaration", "ImportDeclaration", "ImportEqualsDeclaration", "ExportAssignment", "NamespaceExportDeclaration", "ExportDeclaration"]);
function hasAwaitIdentifier(g, top) {
  if (AWAIT_OPAQUE.has(g.kind)) return false;
  if (g.kind === "Identifier") return g.scalars.get("Text")?.s === "await";
  if (g.kind === "ClassDeclaration" && (g.children.get("modifiers")?.modifierFlags ?? 0) & (1 << 7)) return false;
  for (const [name, c] of g.children) {
    if (FUNCTION_LIKE.has(g.kind) && name === "Body" && c.kind === "Block") continue;
    if (name === "name" && BINDING_NAMED.has(g.kind) && c.kind === "Identifier") continue;
    if (name === "name" && PROPERTY_NAMED.has(g.kind)) continue;
    if (c.list) { for (const x of c.nodes) if (hasAwaitIdentifier(x, false)) return true; } else if (hasAwaitIdentifier(c, false)) return true;
  }
  return false;
}
const PROPERTY_NAMED = new Set(["PropertyDeclaration", "MethodDeclaration", "GetAccessor", "SetAccessor", "PropertyAssignment", "ShorthandPropertyAssignment", "PropertySignature", "MethodSignature", "EnumMember"]);

export function externalModuleIndicator(root, opts = {}) {
  for (const s of root.children.get("Statements").nodes) {
    const mods = s.children.get("modifiers");
    if (mods && mods.modifierFlags & (1 << 5)) return s;
    if (s.kind === "ImportEqualsDeclaration" && s.children.get("ModuleReference")?.kind === "ExternalModuleReference") return s;
    if (s.kind === "ImportDeclaration" || s.kind === "ExportAssignment" || s.kind === "ExportDeclaration") return s;
  }
  if (root.flags & GOF.PossiblyContainsImportMeta) {
    const found = findFirst(root, g => g.kind === "MetaProperty" && g.scalars.get("KeywordToken")?.k === "ImportKeyword" && g.children.get("name")?.scalars.get("Text")?.s === "meta");
    if (found) return found;
  }
  if (opts.isDeclarationFile) return null;
  if (opts.jsx) { const j = findFirst(root, g => g.kind === "JsxSelfClosingElement" || g.kind === "JsxOpeningElement" || g.kind === "JsxFragment"); if (j) return j; }
  if (opts.force) return root;
  return null;
}
function findFirst(g, check) {
  if (check(g)) return g;
  const e = byKind.get(g.kind);
  const order = e ? e.memberOrder : [...g.children.keys()];
  for (const name of order) {
    const c = g.children.get(name);
    if (!c) continue;
    if (c.list) { for (const x of c.nodes) { const r = findFirst(x, check); if (r) return r; } } else { const r = findFirst(c, check); if (r) return r; }
  }
  return null;
}

// ---------- printing in the canonical form of the Go probe ----------
export function quoteToASCII(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i);
    if (c > 0xffff) i++;
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (c >= 0x20 && c < 0x7f) out += String.fromCharCode(c);
    else if (c === 7) out += "\\a";
    else if (c === 8) out += "\\b";
    else if (c === 12) out += "\\f";
    else if (c === 10) out += "\\n";
    else if (c === 13) out += "\\r";
    else if (c === 9) out += "\\t";
    else if (c === 11) out += "\\v";
    else if (c < 0x20 || c === 0x7f) out += "\\x" + c.toString(16).padStart(2, "0");
    else if (c >= 0xd800 && c <= 0xdfff) out += "\\xed\\x" + (0xa0 | ((c >> 6) & 0x3f)).toString(16) + "\\x" + (0x80 | (c & 0x3f)).toString(16);
    else if (c <= 0xffff) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += "\\U" + c.toString(16).padStart(8, "0");
  }
  return out + '"';
}
const hex = x => (x === 0 ? "0x0" : "0x" + (x >>> 0).toString(16));

export function print(root) {
  const lines = [];
  const seen = new Set();
  function list(label, l, indent, parent) {
    lines.push(`${" ".repeat(indent)}.${label}: list [${l.pos},${l.end}) n=${l.nodes.length}`);
    for (const c of l.nodes) node("-", c, indent + 2, parent);
  }
  function node(label, n, indent, parent) {
    const pad = " ".repeat(indent);
    let line = `${pad}${label} Kind${n.kind} [${n.pos},${n.end}) f=${hex(n.flags)}`;
    if (n.parent !== parent) line += n.parent ? ` parent=Kind${n.parent.kind}[${n.parent.pos},${n.parent.end})` : " parent=nil";
    if (seen.has(n)) { lines.push(line + " SHARED"); return; }
    seen.add(n);
    const names = [...new Set([...n.scalars.keys(), ...n.children.keys()])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const name of names) {
      const v = n.scalars.get(name);
      if (!v) continue;
      if ("k" in v) line += ` ${name}=Kind${v.k}`;
      else if ("x" in v) line += ` ${name}=${hex(v.x)}`;
      else if ("s" in v) line += ` ${name}=${quoteToASCII(v.s)}`;
      else if ("b" in v) { if (v.b) line += ` ${name}`; }
    }
    lines.push(line);
    if (n.kind === "SourceFile") {
      list("Statements", n.children.get("Statements"), indent + 2, n);
      node(".EndOfFileToken:", n.children.get("EndOfFileToken"), indent + 2, n);
    } else {
      for (const name of names) {
        const c = n.children.get(name);
        if (!c) continue;
        if (c.list) {
          if (c.modifiers) lines.push(`${pad}  .${name}.flags=${hex(c.modifierFlags)}`);
          list(c.raw ? name + "(raw)" : name, c, indent + 2, n);
        } else node("." + name + ":", c, indent + 2, n);
      }
    }
    if (n.flags & GOF.HasJSDoc) for (const j of n.jsdoc) node(".jsdoc:", j, indent + 2, n);
  }
  node("root", root, 0, undefined);
  return lines;
}

export function importDump(bundle, index = 0, opts = {}) {
  const d = bundle.files[index];
  const isJS = d.scriptKind === 1 || d.scriptKind === 2;
  const root = postprocess(convert(inflate(bundle, d), { isJS, textBytes: Buffer.from(d.text, "utf8"), text: d.text }), d);
  root.isJS = isJS;
  setParents(root);
  if (isJS && !opts.noReparse) {
    const before = root.externalModuleIndicator;
    reparse(root);
    // The indicator is computed after the reparsed statements are in the list: an exported overload signature counts, an @import tag does not.
    root.externalModuleIndicator = externalModuleIndicator(root, { isDeclarationFile: d.isDeclarationFile, force: d.force, jsx: d.jsx });
    if (before !== root.externalModuleIndicator) hit(before ? "module-indicator-moved-by-reparse" : "module-indicator-made-by-reparse");
  }
  return root;
}
