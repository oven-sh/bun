// Dumps the tree that TypeScript builds for a file, as the flat JSON that the importer of bun_typecheck reads.
// usage: bun dump-ast.ts [--force] [--jsx] --out <file.json> <name>=<path>...
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

export const DUMP_VERSION = 1;
const SK = ts.SyntaxKind;

// One name per kind: the first name of the enum that is not a range marker.
const kindNames = new Map<number, string>();
for (const [name, value] of Object.entries(SK)) {
  if (typeof value !== "number" || /^(First|Last)/.test(name) || name === "Count") continue;
  if (!kindNames.has(value)) kindNames.set(value, name);
}

// Properties of a node that are not syntax.
const NOT_SYNTAX = new Set([
  "pos", "end", "kind", "id", "flags", "modifierFlagsCache", "transformFlags", "parent", "original", "emitNode", "symbol",
  "localSymbol", "locals", "nextContainer", "flowNode", "endFlowNode", "returnFlowNode", "jsDoc", "jsDocCache",
  "contextualType", "inferenceContext", "assertClause",
]);
const SOURCE_FILE_SYNTAX = new Set(["statements", "endOfFileToken"]);
// Properties whose number is a SyntaxKind.
const KIND_VALUED = new Set(["token", "operator", "keywordToken", "phaseModifier"]);
// The kinds whose parse function in typescript-go ends with withJSDoc.
const JSDOC_HOSTS = new Set<number>(
  [
    "EndOfFileToken", "Block", "EmptyStatement", "IfStatement", "DoStatement", "WhileStatement", "ForStatement",
    "ForInStatement", "ForOfStatement", "BreakStatement", "ContinueStatement", "ReturnStatement", "WithStatement",
    "CaseClause", "DefaultClause", "CaseBlock", "SwitchStatement", "ThrowStatement", "TryStatement",
    "DebuggerStatement", "LabeledStatement", "ExpressionStatement", "VariableStatement", "VariableDeclaration",
    "FunctionDeclaration", "ClassDeclaration", "ClassExpression", "SemicolonClassElement",
    "ClassStaticBlockDeclaration", "Constructor", "MethodDeclaration", "PropertyDeclaration", "GetAccessor",
    "SetAccessor", "IndexSignature", "InterfaceDeclaration", "TypeAliasDeclaration", "EnumMember", "EnumDeclaration",
    "ModuleDeclaration", "ImportDeclaration", "ImportEqualsDeclaration", "ExportAssignment",
    "NamespaceExportDeclaration", "ExportDeclaration", "ExportSpecifier", "CallSignature", "ConstructSignature",
    "Parameter", "PropertySignature", "MethodSignature", "NamedTupleMember", "FunctionType", "ConstructorType",
    "ArrowFunction", "ParenthesizedExpression", "PropertyAssignment", "ShorthandPropertyAssignment",
    "SpreadAssignment", "FunctionExpression", "MissingDeclaration",
  ].map(name => (SK as any)[name] as number),
);

export const JSDOC_PRESENT = 1;
export const JSDOC_DEPRECATED = 2;
export const JSDOC_SEE_OR_LINK = 4;

export interface DumpOptions {
  // The two inputs of typescript-go's ExternalModuleIndicatorOptions.
  force?: boolean;
  jsx?: boolean;
}

export interface FileDump {
  fileName: string;
  scriptKind: number;
  languageVariant: number;
  isDeclarationFile: boolean;
  force: boolean;
  jsx: boolean;
  text: string;
  textLen: number;
  nodes: number[];
  lists: number[];
  attrs: number[];
  diagnostics: [number, number, number, number, string][];
  jsDocDiagnostics: [number, number, number, number, string][];
  commentDirectives: [number, number, number][];
  referencedFiles: [number, number, string, number, number][];
  typeReferenceDirectives: [number, number, string, number, number][];
  libReferenceDirectives: [number, number, string, number, number][];
  checkJs: [number, number, number] | null;
  hasNoDefaultLib: boolean;
}

export interface Dump {
  v: number;
  ts: string;
  kinds: string[];
  props: string[];
  strings: string[];
  files: FileDump[];
}

class Interner {
  list: string[] = [];
  index = new Map<string, number>();
  add(s: string): number {
    let i = this.index.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(s);
      this.index.set(s, i);
    }
    return i;
  }
}

function isNode(v: any): v is ts.Node {
  return v !== null && typeof v === "object" && typeof v.kind === "number" && typeof v.pos === "number";
}

function scriptKindOf(fileName: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  switch (lower.slice(lower.lastIndexOf("."))) {
    case ".js":
    case ".cjs":
    case ".mjs":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".json":
      return ts.ScriptKind.JSON;
    default:
      return ts.ScriptKind.TS;
  }
}

// Offsets of TypeScript count UTF-16 code units; typescript-go counts bytes of UTF-8.
function utf8Offsets(text: string): Uint32Array {
  const map = new Uint32Array(text.length + 1);
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    map[i] = bytes;
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      map[++i] = bytes;
      bytes += 4;
    } else bytes += 3;
  }
  map[text.length] = bytes;
  return map;
}

function startsWithTag(text: string, at: number, tags: string[]): boolean {
  for (const tag of tags) {
    if (!text.startsWith(tag, at)) continue;
    if (text.length === at + tag.length) return true;
    const c = text.charCodeAt(at + tag.length);
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x7d || c === 0x2a) return true;
  }
  return false;
}

// The three JSDoc bits that typescript-go's scanner sets on the token after the trivia at `pos`.
function jsdocScannerInfo(text: string, pos: number): number {
  const ranges = [
    ...(pos > 0 ? (ts.getTrailingCommentRanges(text, pos) ?? []) : []),
    ...(ts.getLeadingCommentRanges(text, pos) ?? []),
  ];
  let info = 0;
  for (const range of ranges) {
    if (range.kind !== SK.MultiLineCommentTrivia) continue;
    if (text.charCodeAt(range.pos + 2) !== 0x2a || text.charCodeAt(range.pos + 3) === 0x2f) continue;
    info |= JSDOC_PRESENT;
    const body = text.slice(range.pos, range.end);
    for (let at = body.indexOf("@"); at >= 0; at = body.indexOf("@", at + 1)) {
      if (startsWithTag(body, at + 1, ["deprecated"])) info |= JSDOC_DEPRECATED;
      if (startsWithTag(body, at + 1, ["see", "link", "linkcode", "linkplain"])) info |= JSDOC_SEE_OR_LINK;
    }
  }
  return info;
}

export function dumpFile(
  fileName: string,
  sourceText: string,
  options: DumpOptions,
  kinds: Interner,
  props: Interner,
  strings: Interner,
): FileDump {
  const text = sourceText.charCodeAt(0) === 0xfeff ? sourceText.slice(1) : sourceText;
  const force = !!options.force;
  const jsx = !!options.jsx;
  const sf = ts.createSourceFile(
    fileName,
    text,
    {
      languageVersion: ts.ScriptTarget.Latest,
      jsDocParsingMode: ts.JSDocParsingMode.ParseAll,
      // A file that is a module is parsed with top-level await; the importer computes the indicator node itself.
      setExternalModuleIndicator: file => {
        const containsJsx = ((file as any).transformFlags & (ts as any).TransformFlags.ContainsJsx) !== 0;
        file.externalModuleIndicator =
          (ts as any).isFileProbablyExternalModule(file) ||
          (!file.isDeclarationFile && (force || (jsx && containsJsx)) ? file : undefined);
      },
    },
    false,
    scriptKindOf(fileName),
  );
  const map = utf8Offsets(text);
  const p = (pos: number) => (pos < 0 ? pos : pos > text.length ? map[text.length] + (pos - text.length) : map[pos]);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, sf.languageVariant, text);
  const nodes: number[] = [];
  const lists: number[] = [];
  const attrs: number[] = [];
  let count = 0;

  const attr = (node: number, key: string, type: number, value: number) => attrs.push(node, props.add(key), type, value);

  function firstToken(pos: number): ts.SyntaxKind {
    scanner.resetTokenState(pos);
    return scanner.scan();
  }

  function isSimpleArrow(arrow: ts.ArrowFunction): boolean {
    if (arrow.parameters.length !== 1) return false;
    const token = firstToken(arrow.modifiers?.length ? arrow.modifiers.end : arrow.pos);
    return token !== SK.OpenParenToken && token !== SK.LessThanToken;
  }

  function jsdocInfoOf(n: ts.Node, parent: ts.Node | undefined): number {
    if (!JSDOC_HOSTS.has(n.kind)) return 0;
    const info = jsdocScannerInfo(text, n.pos);
    if (info === 0) return 0;
    // A statement that starts with `(` leaves its comment to the parenthesized expression.
    if (ts.isExpressionStatement(n) && firstToken(n.pos) === SK.OpenParenToken) return 0;
    // The inner declarations of `namespace a.b.c` have no comment of their own.
    if (ts.isModuleDeclaration(n) && n.flags & ts.NodeFlags.NestedNamespace) return 0;
    // The parameter of `x => x` is made from the identifier; the comment belongs to the arrow function.
    if (ts.isParameter(n) && parent && ts.isArrowFunction(parent) && isSimpleArrow(parent)) return 0;
    return info;
  }

  function visit(n: ts.Node, parentIndex: number, key: string, list: number, parent: ts.Node | undefined): void {
    const me = count++;
    const kindName = kindNames.get(n.kind) ?? "Unknown";
    nodes.push(kinds.add(kindName), p(n.pos), p(n.end), n.flags >>> 0, parentIndex, props.add(key), list, jsdocInfoOf(n, parent));

    // forEachChild gives the children and their order; the property that holds a child is found by identity.
    const holder = new Map<object, { key: string; array?: readonly ts.Node[] }>();
    const isSourceFile = n.kind === SK.SourceFile;
    for (const k of Object.keys(n)) {
      if (NOT_SYNTAX.has(k)) continue;
      if (isSourceFile && !SOURCE_FILE_SYNTAX.has(k)) continue;
      const v = (n as any)[k];
      if (v === undefined || v === null) continue;
      if (isNode(v)) {
        if (!holder.has(v) || k === "fullName") holder.set(v, { key: k });
      } else if (Array.isArray(v)) {
        if (v.length === 0 ? typeof (v as any).pos === "number" : isNode(v[0])) {
          holder.set(v, { key: k, array: v });
          for (const element of v) if (!holder.has(element)) holder.set(element, { key: k, array: v });
        }
      } else if (typeof v === "boolean") {
        if (v) attr(me, k, 0, 1);
      } else if (typeof v === "number") {
        if (KIND_VALUED.has(k)) attr(me, k, 1, kinds.add(kindNames.get(v) ?? "Unknown"));
        else attr(me, k, 3, v);
      } else if (typeof v === "string") {
        // TypeScript escapes a leading `__` of an identifier; the dump has the text as written.
        if (k === "escapedText") attr(me, "text", 2, strings.add(ts.unescapeLeadingUnderscores(v as ts.__String)));
        else attr(me, k, 2, strings.add(v));
      }
    }
    const listOf = new Map<object, number>();
    const done = new Set<object>();
    const openList = (array: readonly ts.Node[], k: string): number => {
      let index = listOf.get(array);
      if (index === undefined) {
        index = lists.length / 5;
        const range = array as Partial<ts.NodeArray<ts.Node>>;
        const hasRange = typeof range.pos === "number" && typeof range.end === "number";
        lists.push(me, props.add(k), hasRange ? p(range.pos!) : -1, hasRange ? p(range.end!) : -1, range.hasTrailingComma ? 1 : 0);
        listOf.set(array, index);
      }
      return index;
    };
    ts.forEachChild(
      n,
      child => {
        const h = holder.get(child);
        if (h === undefined) throw new Error(`${fileName}: a child of ${kindName} at ${n.pos} is in no property`);
        if (done.has(child)) return;
        done.add(child);
        visit(child, me, h.key, h.array ? openList(h.array, h.key) : -1, n);
      },
      array => {
        const h = holder.get(array);
        if (h === undefined) throw new Error(`${fileName}: a list of ${kindName} at ${n.pos} is in no property`);
        if (done.has(array)) return;
        done.add(array);
        const index = openList(array, h.key);
        for (const child of array) {
          done.add(child);
          visit(child, me, h.key, index, n);
        }
      },
    );

    // forEachChild walks the lists of JSDoc nodes element by element: an empty list is recorded here.
    if (n.kind >= SK.FirstJSDocNode && n.kind <= SK.LastJSDocNode) {
      for (const k of Object.keys(n)) {
        const v = (n as any)[k];
        if (Array.isArray(v) && v.length === 0 && typeof (v as any).pos === "number" && !NOT_SYNTAX.has(k) && !listOf.has(v)) openList(v, k);
      }
    }
    if (n.kind === SK.StringLiteral || n.kind === SK.BigIntLiteral || n.kind === SK.RegularExpressionLiteral) {
      // TypeScript keeps neither the escape flags of a string nor the flags of a bigint on the node: scan the token again.
      scanner.resetTokenState(n.pos);
      let token = scanner.scan();
      if (n.kind === SK.RegularExpressionLiteral && (token === SK.SlashToken || token === SK.SlashEqualsToken)) {
        token = scanner.reScanSlashToken();
      }
      const ok = token === n.kind && scanner.getTokenEnd() === n.end;
      attr(me, "$tokenFlags", 3, ok ? scanner.getTokenFlags() : -1);
      if (n.kind === SK.StringLiteral && text.charCodeAt(scanner.getTokenStart()) === 0x27) attr(me, "$singleQuote", 0, 1);
    }
    const jsDoc = (n as any).jsDoc as ts.JSDoc[] | undefined;
    if (jsDoc) for (const comment of jsDoc) visit(comment, me, "jsDoc", -1, n);
  }
  visit(sf, -1, "", -1, undefined);

  const fileReference = (r: ts.FileReference): [number, number, string, number, number] => [
    p(r.pos),
    p(r.end),
    r.fileName,
    r.resolutionMode ?? 0,
    r.preserve ? 1 : 0,
  ];
  const directives: [number, number, number][] = [];
  for (const d of sf.commentDirectives ?? []) {
    const last = directives[directives.length - 1];
    const next: [number, number, number] = [p(d.range.pos), p(d.range.end), d.type];
    // A statement that TypeScript parses twice for top-level await leaves its directive twice.
    if (!last || last[0] !== next[0] || last[1] !== next[1]) directives.push(next);
  }
  const internal = sf as any;
  return {
    fileName,
    scriptKind: internal.scriptKind,
    languageVariant: sf.languageVariant,
    isDeclarationFile: sf.isDeclarationFile,
    force,
    jsx,
    text,
    textLen: map[text.length],
    nodes,
    lists,
    attrs,
    diagnostics: internal.parseDiagnostics.map((d: ts.DiagnosticWithLocation) => [
      p(d.start),
      p(d.start + d.length) - p(d.start),
      d.code,
      d.category,
      ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    ]),
    jsDocDiagnostics: (internal.jsDocDiagnostics ?? []).map((d: ts.DiagnosticWithLocation) => [
      p(d.start),
      p(d.start + d.length) - p(d.start),
      d.code,
      d.category,
      ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    ]),
    commentDirectives: directives,
    referencedFiles: sf.referencedFiles.map(fileReference),
    typeReferenceDirectives: sf.typeReferenceDirectives.map(fileReference),
    libReferenceDirectives: sf.libReferenceDirectives.map(fileReference),
    checkJs: internal.checkJsDirective
      ? [internal.checkJsDirective.enabled ? 1 : 0, p(internal.checkJsDirective.pos), p(internal.checkJsDirective.end)]
      : null,
    hasNoDefaultLib: !!sf.hasNoDefaultLib,
  };
}

export function dumpFiles(inputs: { name: string; text: string }[], options: DumpOptions = {}): Dump {
  const kinds = new Interner();
  const props = new Interner();
  const strings = new Interner();
  const files = inputs.map(input => dumpFile(input.name, input.text, options, kinds, props, strings));
  return { v: DUMP_VERSION, ts: ts.version, kinds: kinds.list, props: props.list, strings: strings.list, files };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const options: DumpOptions = {};
  let out: string | undefined;
  const inputs: { name: string; text: string }[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--force") options.force = true;
    else if (arg === "--jsx") options.jsx = true;
    else if (arg === "--out") out = args[++i];
    else {
      const eq = arg.indexOf("=");
      if (eq < 0) throw new Error(`expected <name>=<path>, got ${arg}`);
      inputs.push({ name: arg.slice(0, eq), text: readFileSync(arg.slice(eq + 1), "utf8") });
    }
  }
  const json = JSON.stringify(dumpFiles(inputs, options));
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);
}
