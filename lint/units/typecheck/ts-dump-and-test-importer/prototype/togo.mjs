// Research probe: builds typescript-go shaped nodes from a raw dump and prints the canonical text.
import { ts } from "./rawdump.mjs";
import { shapeOf, goKindOf, convertFlags, makePositionMap, readRaw } from "./convert.mjs";

const SK = ts.SyntaxKind;
const TF = ts.TokenFlags;
const GO_REPARSED = 1 << 3;
const GO_HAS_JSDOC = 1 << 21;
const GO_DEPRECATED = 1 << 26;
const GO_SINGLE_QUOTE = 1 << 16;

const MOD = new Map([
  ["StaticKeyword", 1 << 8], ["PublicKeyword", 1 << 0], ["ProtectedKeyword", 1 << 2], ["PrivateKeyword", 1 << 1],
  ["AbstractKeyword", 1 << 6], ["AccessorKeyword", 1 << 9], ["ExportKeyword", 1 << 5], ["DeclareKeyword", 1 << 7],
  ["ConstKeyword", 1 << 12], ["DefaultKeyword", 1 << 11], ["AsyncKeyword", 1 << 10], ["ReadonlyKeyword", 1 << 3],
  ["OverrideKeyword", 1 << 4], ["InKeyword", 1 << 13], ["OutKeyword", 1 << 14], ["Decorator", 1 << 15],
]);

const STRING_FLAGS = TF.Unterminated | TF.HexEscape | TF.UnicodeEscape | TF.ExtendedUnicodeEscape | TF.ContainsInvalidEscape;
const NUMERIC_FLAGS = TF.Scientific | TF.Octal | TF.ContainsLeadingZero | TF.HexSpecifier | TF.BinarySpecifier | TF.OctalSpecifier | TF.ContainsSeparator | TF.ContainsInvalidSeparator;
const TEMPLATE_FLAGS = STRING_FLAGS;
const REGEX_FLAGS = TF.Unterminated;

// TypeScript-only properties with no counterpart in typescript-go.
const DROP = new Set(["numericLiteralFlags", "hasExtendedUnicodeEscape", "isUnterminated", "possiblyExhaustive", "postfix", "singleQuote"]);

// Kinds for which typescript-go's parser calls withJSDoc.
const JSDOC_HOSTS = new Set([
  "EndOfFile", "Block", "EmptyStatement", "IfStatement", "DoStatement", "WhileStatement", "ForStatement", "ForInStatement",
  "ForOfStatement", "BreakStatement", "ContinueStatement", "ReturnStatement", "WithStatement", "CaseClause", "DefaultClause",
  "CaseBlock", "SwitchStatement", "ThrowStatement", "TryStatement", "DebuggerStatement", "ExpressionStatement", "LabeledStatement",
  "VariableStatement", "VariableDeclaration", "FunctionDeclaration", "ClassDeclaration", "ClassExpression", "SemicolonClassElement",
  "ClassStaticBlockDeclaration", "Constructor", "MethodDeclaration", "PropertyDeclaration", "InterfaceDeclaration",
  "TypeAliasDeclaration", "EnumMember", "EnumDeclaration", "ModuleDeclaration", "ImportDeclaration", "ImportEqualsDeclaration",
  "ExportAssignment", "ExportDeclaration", "NamespaceExportDeclaration", "ExportSpecifier", "CallSignature", "ConstructSignature",
  "Parameter", "GetAccessor", "SetAccessor", "IndexSignature", "PropertySignature", "MethodSignature", "NamedTupleMember",
  "FunctionType", "ConstructorType", "ArrowFunction", "ParenthesizedExpression", "PropertyAssignment", "ShorthandPropertyAssignment",
  "SpreadAssignment", "FunctionExpression",
]);

export class Stats {
  unmapped = new Map();
  note(key) {
    this.unmapped.set(key, (this.unmapped.get(key) ?? 0) + 1);
  }
}

export function toGo(dump, text, stats, opts = {}) {
  const raw = readRaw(dump);
  const u8 = makePositionMap(text);
  const isJS = dump.header.scriptKind === ts.ScriptKind.JS || dump.header.scriptKind === ts.ScriptKind.JSX;

  function jsDocCommentHas(node, re) {
    // The scanner flag of typescript-go looks at the text of every JSDoc comment that precedes the token.
    for (const r of ts.getLeadingCommentRanges(text, node.pos) ?? []) {
      if (r.kind !== SK.MultiLineCommentTrivia) continue;
      const c = text.slice(r.pos, r.end);
      if (c.startsWith("/**") && c.length > 4 && c.charCodeAt(3) !== 0x2f && re.test(c)) return true;
    }
    return false;
  }

  // Port of scanJSDocCommentForTags and hasJSDocTag over every JSDoc comment before the first token of the node.
  function precedingJSDocHasTag(r, tags) {
    const start = ts.skipTrivia(text, r.pos);
    let i = r.pos;
    while (i < start) {
      if (text.charCodeAt(i) === 0x2f && text.charCodeAt(i + 1) === 0x2f) {
        while (i < start && text.charCodeAt(i) !== 0x0a && text.charCodeAt(i) !== 0x0d && text.charCodeAt(i) !== 0x2028 && text.charCodeAt(i) !== 0x2029) i++;
        continue;
      }
      if (text.charCodeAt(i) === 0x2f && text.charCodeAt(i + 1) === 0x2a) {
        let e = text.indexOf("*/", i + 2);
        e = e < 0 ? text.length : e + 2;
        const isJSDoc = text.charCodeAt(i + 2) === 0x2a && text.charCodeAt(i + 3) !== 0x2f;
        if (isJSDoc) {
          if (tags === null) return true;
          let c = text.slice(i, e);
          for (;;) {
            const at = c.indexOf("@");
            if (at < 0) break;
            c = c.slice(at + 1);
            for (const tag of tags) {
              if (!c.startsWith(tag)) continue;
              if (c.length === tag.length) return true;
              const ch = c[tag.length];
              if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "}" || ch === "*") return true;
            }
          }
        }
        i = e;
        continue;
      }
      i++;
    }
    return false;
  }

  function list(l, parentKind, propName) {
    const nodes = [];
    for (const id of l.ids) {
      const c = node(raw[id], parentKind, propName);
      if (c) nodes.push(c);
    }
    return { pos: l.raw ? -1 : u8(l.pos), end: l.raw ? -1 : u8(l.end), nodes, raw: l.raw };
  }

  let blockDepth = 0;
  function node(r, parentKind, parentProp) {
    const isBlockContext = r.kind === SK.Block || r.kind === SK.ModuleBlock || r.kind === SK.CaseClause || r.kind === SK.DefaultClause;
    const inBlockContext = blockDepth > 0;
    if (isBlockContext) blockDepth++;
    try {
      return node1(r, parentKind, parentProp, inBlockContext);
    } finally {
      if (isBlockContext) blockDepth--;
    }
  }
  const GO_AWAIT = 1 << 13;
  const hasExport = g => (g.fields.get("modifiers")?.nodes ?? []).some(m => m.kind === "ExportKeyword");
  const FUNCTION_LIKE = new Set(["FunctionDeclaration", "FunctionExpression", "MethodDeclaration", "Constructor", "GetAccessor", "SetAccessor", "ArrowFunction"]);
  function clearInheritedAwait(g) {
    if ((g.flags & GO_AWAIT) === 0) return;
    g.flags = (g.flags & ~GO_AWAIT) >>> 0;
    for (const [name, v] of g.fields) {
      if (v === null || typeof v !== "object") continue;
      if (FUNCTION_LIKE.has(g.kind) && (name === "Body" || name === "Parameters")) {
        // The modifiers and decorators of a parameter are parsed in the context outside of the function.
        if (name === "Parameters") for (const prm of v.nodes) for (const m of prm.fields.get("modifiers")?.nodes ?? []) clearInheritedAwait(m);
        continue;
      }
      if (g.kind === "ClassStaticBlockDeclaration" && name === "Body") continue;
      if (v.nodes) for (const c of v.nodes) clearInheritedAwait(c);
      else if (v.kind) clearInheritedAwait(v);
    }
  }
  const simpleArrow = g => false;
  function node1(r, parentKind, parentProp, inBlockContext) {
    let kind = goKindOf(r.kind);
    const g = { kind, pos: u8(r.pos), end: u8(r.end), flags: convertFlags(r.flags, r.kind), fields: new Map(), jsdoc: [] };
    // Rule: an omitted element of an array binding pattern is an empty BindingElement.
    if (r.kind === SK.OmittedExpression && parentKind === SK.ArrayBindingPattern) {
      g.kind = "BindingElement";
      return g;
    }
    const shape = shapeOf(kind);
    for (const [name, v] of r.props) {
      if (name === "#tokenFlags" || name === "#jsDoc") continue;
      let go = name === "name" || name === "modifiers" ? name : name[0].toUpperCase() + name.slice(1);
      if (name === "escapedText") go = "Text";
      if ((name === "questionToken" || name === "exclamationToken") && shape.fields.has("PostfixToken")) go = "PostfixToken";
      if (name === "isTypeOnly" && r.kind === SK.ImportClause) continue;
      if (DROP.has(name)) continue;
      if (name === "elements" && r.kind === SK.ImportAttributes) go = "Attributes";
      if (name === "default" && r.kind === SK.TypeParameter) go = "DefaultType";
      if (name === "rawText" && r.kind === SK.NoSubstitutionTemplateLiteral) continue;
      const f = shape.fields.get(go);
      if (!f) {
        stats.note(`${ts.SyntaxKind[r.kind]}.${name}:${Object.keys(v)[0]}`);
        continue;
      }
      if (f.cat === "node" && v.node !== undefined) g.fields.set(go, node(raw[v.node], r.kind, name));
      else if ((f.cat === "list" || f.cat === "modifiers" || f.cat === "rawlist") && v.list) g.fields.set(go, list(v.list, r.kind, name));
      else if (f.cat === "string" && v.string !== undefined) g.fields.set(go, name === "escapedText" ? ts.unescapeLeadingUnderscores(v.string) : v.string);
      else if (f.cat === "bool" && v.bool !== undefined) g.fields.set(go, v.bool);
      else if (f.cat === "kind" && v.int !== undefined) g.fields.set(go, goKindOf(v.int));
      else if (f.cat === "tokenflags" && v.int !== undefined) g.fields.set(go, v.int);
      else stats.note(`${ts.SyntaxKind[r.kind]}.${name}:${Object.keys(v)[0]}!=${f.cat}`);
    }
    // Rule: token flags come from a rescan of the token, masked per kind.
    let tf = r.props.get("#tokenFlags")?.int;
    if (tf !== undefined && tf & TF.ContainsInvalidEscape) {
      const tok = text.slice(ts.skipTrivia(text, r.pos), r.end);
      for (let i = 0; i < tok.length; i++) {
        if (tok.charCodeAt(i) !== 0x5c) continue;
        i++;
        if (tok[i] === "u" && tok[i + 1] !== "{") tf |= TF.UnicodeEscape;
      }
    }
    if (tf !== undefined) {
      switch (r.kind) {
        case SK.StringLiteral: {
          const start = ts.skipTrivia(text, r.pos);
          g.fields.set("TokenFlags", (tf & STRING_FLAGS) | (text.charCodeAt(start) === 0x27 ? GO_SINGLE_QUOTE : 0));
          break;
        }
        case SK.NumericLiteral:
        case SK.BigIntLiteral:
          g.fields.set("TokenFlags", tf & NUMERIC_FLAGS);
          break;
        case SK.RegularExpressionLiteral:
          g.fields.set("TokenFlags", tf & REGEX_FLAGS);
          break;
        case SK.NoSubstitutionTemplateLiteral:
          g.fields.set("TemplateFlags", tf & TEMPLATE_FLAGS);
          break;
        default:
          g.fields.set("TemplateFlags", tf & TEMPLATE_FLAGS);
      }
    }
    // Rule: the keyword of a module declaration replaces two TypeScript node flags.
    if (r.kind === SK.ModuleDeclaration) {
      g.fields.set("Keyword", r.flags & ts.NodeFlags.GlobalAugmentation ? "GlobalKeyword" : r.flags & ts.NodeFlags.Namespace ? "NamespaceKeyword" : "ModuleKeyword");
      if (r.flags & ts.NodeFlags.NestedNamespace) {
        // Rule: the inner declaration of `namespace A.B` carries an implicit export modifier.
        const m = { kind: "ExportKeyword", pos: g.pos, end: g.pos, flags: GO_REPARSED, fields: new Map(), jsdoc: [] };
        g.fields.set("modifiers", { pos: g.pos, end: g.pos, nodes: [m] });
      }
    }
    // Rule: a type heritage clause holds type references, not expressions with type arguments.
    if (r.kind === SK.HeritageClause) {
      const isInterface = parentKind === SK.InterfaceDeclaration;
      const token = r.props.get("token")?.int;
      if ((isInterface && token === SK.ExtendsKeyword) || (!isInterface && token === SK.ImplementsKeyword)) {
        const types = g.fields.get("Types");
        if (types) types.nodes = types.nodes.map(toTypeReference);
      }
    }
    // Rule: only a top level exported class parses its heritage and members in the await context.
    if (r.kind === SK.ClassDeclaration && (g.flags & GO_AWAIT) === 0 && inBlockContext && hasExport(g)) {
      for (const n of g.fields.get("HeritageClauses")?.nodes ?? []) clearInheritedAwait(n);
      for (const n of g.fields.get("Members")?.nodes ?? []) clearInheritedAwait(n);
    }
    // Rule: the `assert` keyword of import attributes is a parse error in typescript-go, so the next finished node carries the error flag.
    if (r.kind === SK.ImportAttributes && r.props.get("token")?.int === SK.AssertKeyword) {
      const first = g.fields.get("Attributes")?.nodes[0];
      const target = first ? (first.fields.get("name") ?? first) : g;
      target.flags = (target.flags | (1 << 15)) >>> 0;
    }
    // Rule: an element access without an argument reports its error after the missing identifier is finished.
    if (r.kind === SK.ElementAccessExpression) {
      const a = g.fields.get("ArgumentExpression");
      if (a && a.kind === "Identifier" && a.pos === a.end && a.fields.get("Text") === "" && a.flags & (1 << 15)) {
        a.flags = (a.flags & ~(1 << 15)) >>> 0;
        g.flags = (g.flags | (1 << 15)) >>> 0;
      }
    }
    // Rule: JSDoc presence flags.
    if (!isJS && !opts.noJSDocFlags && JSDOC_HOSTS.has(g.kind) && precedingJSDocHasTag(r, null)) {
      g.flags |= GO_HAS_JSDOC;
      if (precedingJSDocHasTag(r, ["deprecated"])) g.flags |= GO_DEPRECATED;
    }
    g.flags >>>= 0;
    return g;
  }
  const CONTEXT = (1 << 10) | (1 << 11) | (1 << 12) | (1 << 13) | (1 << 14) | (1 << 16) | (1 << 24) | (1 << 23) | (1 << 22) | (1 << 25);
  function present(n) {
    return n.kind !== "Identifier" || n.end > n.pos || n.fields.get("Text") !== "";
  }
  function validHeritage(e) {
    if (e.kind === "Identifier") return present(e);
    return e.kind === "PropertyAccessExpression" && (e.flags & (1 << 5)) === 0 && present(e.fields.get("name")) && validHeritage(e.fields.get("Expression"));
  }
  function toEntityName(e) {
    if (e.kind === "Identifier") return e;
    const q = { kind: "QualifiedName", pos: e.pos, end: e.end, flags: e.flags & CONTEXT, fields: new Map(), jsdoc: [] };
    q.fields.set("Left", toEntityName(e.fields.get("Expression")));
    q.fields.set("Right", e.fields.get("name"));
    return q;
  }
  function toTypeReference(e) {
    if (e.kind !== "ExpressionWithTypeArguments" || !validHeritage(e.fields.get("Expression"))) return e;
    const t = { kind: "TypeReference", pos: e.pos, end: e.end, flags: e.flags & CONTEXT, fields: new Map(), jsdoc: [] };
    t.fields.set("TypeName", toEntityName(e.fields.get("Expression")));
    if (e.fields.has("TypeArguments")) t.fields.set("TypeArguments", e.fields.get("TypeArguments"));
    return t;
  }
  function hasJSDocHost(kind) {
    return ts.canHaveJSDoc({ kind }) || kind === SK.EndOfFileToken;
  }
  return node(raw[0], -1, "");
}

const hex = n => "0x" + (n >>> 0).toString(16);
function quote(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (c === 7) out += "\\a";
    else if (c === 8) out += "\\b";
    else if (c === 12) out += "\\f";
    else if (c === 10) out += "\\n";
    else if (c === 13) out += "\\r";
    else if (c === 9) out += "\\t";
    else if (c === 11) out += "\\v";
    else if (c < 0x20 || c === 0x7f) out += "\\x" + c.toString(16).padStart(2, "0");
    else if (c < 0x7f) out += ch;
    else if (c >= 0xd800 && c <= 0xdfff) out += "\\x" + (0xed).toString(16) + "\\x" + (0x80 | ((c >> 6) & 0x3f)).toString(16) + "\\x" + (0x80 | (c & 0x3f)).toString(16);
    else if (c < 0x10000) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += "\\U" + c.toString(16).padStart(8, "0");
  }
  return out + '"';
}

export function print(g, out, label = "root", indent = 0) {
  const pad = " ".repeat(indent);
  let line = `${pad}${label} Kind${g.kind} [${g.pos},${g.end}) f=${hex(g.flags)}`;
  const shape = g.kind === "SourceFile" ? { fields: new Map() } : shapeOf(g.kind);
  const names = [...shape.fields.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const n of names) {
    const f = shape.fields.get(n);
    const v = g.fields.get(n);
    if (f.cat === "kind") line += ` ${n}=Kind${v ?? "Unknown"}`;
    else if (f.cat === "tokenflags") line += ` ${n}=${hex(v ?? 0)}`;
    else if (f.cat === "string" || f.cat === "strings") line += ` ${n}=${quote(v ?? "")}`;
    else if (f.cat === "bool" && v) line += ` ${n}`;
  }
  out.push(line);
  const printList = (n, l) => {
    out.push(`${pad}  .${n}${l.raw ? "(raw)" : ""}: list [${l.pos},${l.end}) n=${l.nodes.length}`);
    for (const c of l.nodes) print(c, out, "-", indent + 4);
  };
  if (g.kind === "SourceFile") {
    printList("Statements", g.fields.get("Statements"));
    print(g.fields.get("EndOfFileToken"), out, ".EndOfFileToken:", indent + 2);
  } else {
    for (const n of names) {
      const f = shape.fields.get(n);
      const v = g.fields.get(n);
      if (v === undefined) continue;
      if (f.cat === "node") print(v, out, `.${n}:`, indent + 2);
      else if (f.cat === "list" || f.cat === "rawlist") printList(n, v);
      else if (f.cat === "modifiers") {
        let flags = 0;
        for (const m of v.nodes) flags |= MOD.get(m.kind) ?? 0;
        out.push(`${pad}  .${n}.flags=${hex(flags)}`);
        printList(n, v);
      }
    }
  }
  for (const j of g.jsdoc) print(j, out, ".jsdoc:", indent + 2);
  return out;
}
