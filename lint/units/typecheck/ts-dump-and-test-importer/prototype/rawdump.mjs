// Research probe: raw dump of a TypeScript 6.0.2 tree (candidate for test/cli/lint/typecheck/dump-ast.ts).
// The raw dump carries TypeScript's own facts only. Every conversion to typescript-go's shape is done by the reader.
import { createRequire } from "node:module";
const require = createRequire(process.env.TS_ROOT ?? "/workspace/bun/node_modules/");
export const ts = require("typescript");

// Properties of a TypeScript node object that are never part of the dump.
const SKIP = new Set([
  "pos", "end", "kind", "id", "flags", "modifierFlagsCache", "transformFlags", "parent", "original", "emitNode",
  "symbol", "localSymbol", "locals", "nextContainer", "endFlowNode", "returnFlowNode", "flowNode", "fallthroughFlowNode",
  "jsDoc", "jsDocCache", "contextualType", "inferenceContext", "typeArguments__", "resolvedSymbol", "antecedent",
  "nameTable", "illegalInitializer", "illegalDecorators", "illegalModifiers", "illegalQuestionToken", "illegalExclamationToken",
  "illegalType", "illegalTypeParameters",
  // Deprecated aliases of `attributes`: the same node object under a second name.
  "assertClause", "assertions",
]);
// Properties of the SourceFile node that are dumped in the header, not as node properties.
const SOURCE_FILE_SKIP = new Set([
  "text", "fileName", "path", "resolvedPath", "originalFileName", "languageVersion", "languageVariant", "scriptKind",
  "isDeclarationFile", "hasNoDefaultLib", "bindDiagnostics", "bindSuggestionDiagnostics", "parseDiagnostics", "jsDocDiagnostics",
  "pragmas", "referencedFiles", "typeReferenceDirectives", "libReferenceDirectives", "amdDependencies", "commentDirectives",
  "checkJsDirective", "nodeCount", "identifierCount", "symbolCount", "identifiers", "externalModuleIndicator",
  "commonJsModuleIndicator", "setExternalModuleIndicator", "jsDocParsingMode", "impliedNodeFormat", "packageJsonLocations",
  "packageJsonScope", "lineMap", "imports", "moduleAugmentations", "ambientModuleNames", "typeCount", "instantiationCount",
  "symbolDisplayBuilder", "classifiableNames", "renamedDependencies", "version", "scriptSnapshot", "additionalSyntacticDiagnostics",
  "redirectInfo", "usesUriStyleNodeCoreModules", "moduleName", "endFlowNode", "namedDeclarations", "extendedSourceFiles", "configFileSpecs",
]);

const isNode = v => v !== null && typeof v === "object" && typeof v.kind === "number" && typeof v.pos === "number";
const isNodeArray = v => Array.isArray(v) && typeof v.pos === "number" && typeof v.end === "number";

export function parse(fileName, text, scriptKind) {
  return ts.createSourceFile(
    fileName,
    text,
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseAll },
    /*setParentNodes*/ false,
    scriptKind,
  );
}

export function scriptKindOf(fileName) {
  const m = /\.([cm]?[jt]sx?|json)$/i.exec(fileName);
  switch (m?.[1].toLowerCase()) {
    case "js": case "cjs": case "mjs": return ts.ScriptKind.JS;
    case "jsx": return ts.ScriptKind.JSX;
    case "tsx": return ts.ScriptKind.TSX;
    case "json": return ts.ScriptKind.JSON;
    default: return ts.ScriptKind.TS;
  }
}

// Returns { header, nodes: Int32Array-like number[], lists: number[], strings: string[], props: string[] }.
export function rawDump(fileName, text, scriptKind = scriptKindOf(fileName)) {
  const sf = parse(fileName, text, scriptKind);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /*skipTrivia*/ true, sf.languageVariant, text);
  const strings = [];
  const stringIndex = new Map();
  const props = [];
  const propIndex = new Map();
  const nodes = [];
  const lists = [];
  let nodeCount = 0;
  const intern = s => {
    let i = stringIndex.get(s);
    if (i === undefined) { i = strings.length; strings.push(s); stringIndex.set(s, i); }
    return i;
  };
  const prop = s => {
    let i = propIndex.get(s);
    if (i === undefined) { i = props.length; props.push(s); propIndex.set(s, i); }
    return i;
  };
  // Record layout: kind pos end flags parent nprops (prop tag value)*
  // tag 0 node id, 1 list index, 2 string index, 3 integer, 4 boolean, 5 raw node array (list index, pos = end = -1)
  function rescanFlags(node, parent) {
    const start = ts.skipTrivia(text, node.pos, false, false, true);
    scanner.resetTokenState(start);
    if (node.kind === ts.SyntaxKind.StringLiteral && parent !== undefined && parent.kind === ts.SyntaxKind.JsxAttribute) {
      scanner.scanJsxAttributeValue();
    } else if (node.kind === ts.SyntaxKind.TemplateMiddle || node.kind === ts.SyntaxKind.TemplateTail) {
      scanner.scan();
      scanner.reScanTemplateToken(false);
    } else if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      scanner.scan();
      scanner.reScanSlashToken();
    } else {
      scanner.scan();
    }
    return scanner.getTokenFlags();
  }
  const recs = [];
  function visit(node, parent, parentNode) {
    const id = nodeCount++;
    const rec = [node.kind, node.pos, node.end, node.flags, parent, 0];
    recs.push(rec);
    let n = 0;
    const skip = node.kind === ts.SyntaxKind.SourceFile ? SOURCE_FILE_SKIP : null;
    for (const key of Object.keys(node)) {
      if (SKIP.has(key) || (skip !== null && skip.has(key))) continue;
      const v = node[key];
      if (v === undefined || v === null) continue;
      if (isNode(v)) {
        n++;
        rec.push(prop(key), 0, visit(v, id, node));
      } else if (Array.isArray(v)) {
        n++;
        const ids = [];
        for (const c of v) ids.push(isNode(c) ? visit(c, id, node) : -1);
        rec.push(prop(key), isNodeArray(v) ? 1 : 5, lists.length);
        lists.push(isNodeArray(v) ? v.pos : -1, isNodeArray(v) ? v.end : -1, v.hasTrailingComma ? 1 : 0, ids.length, ...ids);
      } else if (typeof v === "string") {
        n++;
        rec.push(prop(key), 2, intern(v));
      } else if (typeof v === "number") {
        n++;
        rec.push(prop(key), 3, v);
      } else if (typeof v === "boolean") {
        n++;
        rec.push(prop(key), 4, v ? 1 : 0);
      }
    }
    if (node.kind >= ts.SyntaxKind.FirstLiteralToken && node.kind <= ts.SyntaxKind.LastTemplateToken && node.end > node.pos) {
      n++;
      rec.push(prop("#tokenFlags"), 3, rescanFlags(node, parentNode));
    }
    if (node.jsDoc !== undefined) {
      n++;
      const ids = [];
      for (const c of node.jsDoc) ids.push(visit(c, id, node));
      rec.push(prop("#jsDoc"), 5, lists.length);
      lists.push(-1, -1, 0, ids.length, ...ids);
    }
    rec[5] = n;
    return id;
  }
  visit(sf, -1);
  for (const r of recs) for (const x of r) nodes.push(x);
  const diag = d => [d.code, d.category, d.start ?? -1, d.length ?? -1, intern(ts.flattenDiagnosticMessageText(d.messageText, "\n"))];
  const header = {
    format: "bun-tsast",
    version: 1,
    typescript: ts.version,
    fileName,
    scriptKind,
    languageVariant: sf.languageVariant,
    isDeclarationFile: sf.isDeclarationFile,
    utf16Length: text.length,
    nodeCount,
    parseDiagnostics: sf.parseDiagnostics.map(diag),
    jsDocDiagnostics: (sf.jsDocDiagnostics ?? []).map(diag),
    commentDirectives: (sf.commentDirectives ?? []).map(c => [c.range.pos, c.range.end, c.type]),
  };
  return { header, props, strings, nodes, lists, sf };
}

export function serialize(d) {
  const { sf, ...rest } = d;
  const h = JSON.stringify(rest.header);
  return (
    h.slice(0, -1) +
    ',\n"props":' + JSON.stringify(rest.props) +
    ',\n"strings":' + JSON.stringify(rest.strings) +
    ',\n"nodes":[' + rest.nodes.join(",") + "]" +
    ',\n"lists":[' + rest.lists.join(",") + "]}\n"
  );
}
