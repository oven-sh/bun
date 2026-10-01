// Research probe: the conversion rules of the importer, prototyped in JavaScript.
// Input: a raw dump (rawdump.mjs) plus the source text. Output: the canonical text of the Go probe (dumpast).
import fs from "node:fs";
import { ts } from "./rawdump.mjs";

const schema = JSON.parse(fs.readFileSync("/workspace/ref/typescript-go/_scripts/ast.json", "utf8"));

// ---- tables derived from ast.json ----
const goKinds = [];
for (const e of schema.kinds.elements) {
  if (typeof e === "string") goKinds.push(e);
  else if (e.name) goKinds.push(e.name);
}
const goKindSet = new Set(goKinds);

function baseFields(baseName, out = new Map()) {
  const b = schema.bases[baseName];
  if (!b) return out;
  for (const e of b.extends ?? []) baseFields(e, out);
  for (const [k, f] of Object.entries(b.fields ?? {})) out.set(k, f);
  return out;
}
function category(m) {
  if (m.list === "NodeList") return "list";
  if (m.list === "ModifierList") return "modifiers";
  if (m.list === "raw") return m.type === "string" ? "strings" : "rawlist";
  const t = m.type;
  if (t === "string") return "string";
  if (t === "bool") return "bool";
  if (t === "TokenFlags") return "tokenflags";
  if (t === "NodeFlags") return "nodeflags";
  if (t === "ModifierFlags") return "skip";
  if (t === "any") return "skip";
  if (Array.isArray(t) && t.every(x => x.startsWith("SyntaxKind."))) return "kind";
  if (t === "ImportPhaseModifierSyntaxKind" || t === "TKind") return "kind";
  if (typeof t === "string" && (t.startsWith("*") || t === "SymbolTable" || t.startsWith("atomic."))) return "skip";
  return "node";
}
// kind name -> { def, fields: Map(goName -> {cat, optional}) }
const shapes = new Map();
for (const [defName, def] of Object.entries(schema.nodes.definitions)) {
  const fields = new Map();
  const inherited = new Map();
  for (const e of def.extends) baseFields(e, inherited);
  // Go embeds every base: all base fields exist on the struct whether or not the definition lists them.
  for (const [k, f] of inherited) {
    if (f.goOnly || f.noGo) continue;
    const cat = category(f);
    if (cat !== "skip" && cat !== "nodeflags") fields.set(k, { cat, optional: !!f.optional });
  }
  for (const m of def.members ?? []) {
    if (m.goOnly || m.noGo) continue;
    if (m.name === "Kind" || m.name === "Flags") continue;
    const merged = { ...(inherited.get(m.name) ?? {}), ...m };
    const cat = category(merged);
    if (cat !== "skip" && cat !== "nodeflags") fields.set(m.name, { cat, optional: !!merged.optional });
  }
  const kinds = [];
  if (Array.isArray(def.kind)) kinds.push(...def.kind);
  else if (typeof def.kind === "string") kinds.push(def.kind);
  else if (goKindSet.has(defName)) kinds.push(defName);
  const kindMember = (def.members ?? []).find(m => m.name === "Kind");
  if (kindMember && Array.isArray(kindMember.type)) for (const k of kindMember.type) kinds.push(k.replace("SyntaxKind.", ""));
  if (def.instantiationAliases) {
    // Token, KeywordExpression, KeywordTypeNode: every kind that is not claimed elsewhere falls back to Token.
  }
  for (const k of kinds) shapes.set(k, { defName, fields });
}
const tokenShape = { defName: "Token", fields: new Map() };
export function shapeOf(goKind) {
  return shapes.get(goKind) ?? tokenShape;
}

// ---- kinds ----
const tsKindName = [];
for (const k of Object.keys(ts.SyntaxKind)) {
  if (/^\d+$/.test(k)) continue;
  const v = ts.SyntaxKind[k];
  // Several names share a value (markers, deprecated aliases): the name that typescript-go knows wins.
  if (tsKindName[v] === undefined || (!goKindSet.has(tsKindName[v]) && goKindSet.has(k))) tsKindName[v] = k;
}
const KIND_RENAME = new Map([
  ["EndOfFileToken", "EndOfFile"],
  ["JSDocTag", "JSDocUnknownTag"],
  ["JSDocAuthorTag", "JSDocUnknownTag"],
  ["JSDocClassTag", "JSDocUnknownTag"],
  ["JSDocEnumTag", "JSDocUnknownTag"],
  ["JSDocMemberName", "QualifiedName"],
]);
export function goKindOf(tsKind) {
  const n = tsKindName[tsKind];
  return KIND_RENAME.get(n) ?? n;
}

// ---- flags ----
const NF = ts.NodeFlags;
const GO = {
  Let: 1 << 0, Const: 1 << 1, Using: 1 << 2, Reparsed: 1 << 3, Synthesized: 1 << 4, OptionalChain: 1 << 5,
  ExportContext: 1 << 6, ContainsThis: 1 << 7, HasImplicitReturn: 1 << 8, HasExplicitReturn: 1 << 9,
  DisallowInContext: 1 << 10, YieldContext: 1 << 11, DecoratorContext: 1 << 12, AwaitContext: 1 << 13,
  DisallowConditionalTypesContext: 1 << 14, ThisNodeHasError: 1 << 15, JavaScriptFile: 1 << 16,
  ThisNodeOrAnySubNodesHasError: 1 << 17, HasAsyncFunctions: 1 << 18, PossiblyContainsDynamicImport: 1 << 19,
  PossiblyContainsImportMeta: 1 << 20, HasJSDoc: 1 << 21, JSDoc: 1 << 22, Ambient: 1 << 23, InWithStatement: 1 << 24,
  JsonFile: 1 << 25, PossiblyContainsDeprecatedTag: 1 << 26, Unreachable: 1 << 27, ReparserTransformedLiteral: 1 << 28,
};
// Flags that typescript-go's parser sets and that have the same meaning in TypeScript, by name.
const SAME_NAME = [
  "Let", "Const", "Using", "OptionalChain", "DisallowInContext", "YieldContext", "DecoratorContext", "AwaitContext",
  "DisallowConditionalTypesContext", "ThisNodeHasError", "JavaScriptFile", "PossiblyContainsDynamicImport",
  "PossiblyContainsImportMeta", "JSDoc", "Ambient", "InWithStatement", "JsonFile",
];
export function convertFlags(tsFlags, tsKind) {
  let f = 0;
  for (const n of SAME_NAME) if (tsFlags & NF[n]) f |= GO[n];
  if (tsKind === ts.SyntaxKind.Identifier && tsFlags & NF.IdentifierIsInJSDocNamespace) f |= GO.HasAsyncFunctions;
  return f >>> 0;
}

// ---- positions ----
export function makePositionMap(text) {
  let ascii = true;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) >= 0x80) { ascii = false; break; }
  if (ascii) return p => p;
  const map = new Uint32Array(text.length + 1);
  let b = 0;
  for (let i = 0; i < text.length; i++) {
    map[i] = b;
    const c = text.charCodeAt(i);
    if (c < 0x80) b += 1;
    else if (c < 0x800) b += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      map[i + 1] = b;
      b += 4;
      i++;
    } else b += 3;
  }
  map[text.length] = b;
  return p => (p < 0 ? p : map[p]);
}

// ---- reading the raw dump ----
export function readRaw(d) {
  const { nodes, lists, props, strings } = d;
  const out = [];
  let i = 0;
  while (i < nodes.length) {
    const n = { id: out.length, kind: nodes[i], pos: nodes[i + 1], end: nodes[i + 2], flags: nodes[i + 3], parent: nodes[i + 4], props: new Map() };
    const np = nodes[i + 5];
    i += 6;
    for (let k = 0; k < np; k++, i += 3) {
      const name = props[nodes[i]], tag = nodes[i + 1], v = nodes[i + 2];
      if (tag === 0) n.props.set(name, { node: v });
      else if (tag === 1 || tag === 5) {
        const cnt = lists[v + 3];
        n.props.set(name, { list: { pos: lists[v], end: lists[v + 1], comma: lists[v + 2] === 1, ids: lists.slice(v + 4, v + 4 + cnt), raw: tag === 5 } });
      } else if (tag === 2) n.props.set(name, { string: strings[v] });
      else if (tag === 3) n.props.set(name, { int: v });
      else n.props.set(name, { bool: v === 1 });
    }
    out.push(n);
  }
  return out;
}
