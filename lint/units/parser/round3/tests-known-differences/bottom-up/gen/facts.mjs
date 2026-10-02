// What a lint parse has to show for a row, read from the tree of tsc 6.0.2:
//   roots      the type-grammar roots (roots.mjs): what type_sink_tests.rs reads alone
//   kept       the tags of the statements that the file keeps, in order (Stmt::data.tag())
//   erased     the records of the dropped statements and class members, in the lines of parse/erased_tests.rs
//   wrappers   the records of as, satisfies, !, <T>x and parentheses, in the lines of the tests of parse/wrappers.rs
//   nodes      e_if, e_arrow and e_call of the kept tree and auto_accessor members, each with the offset Bun gives the node, sorted
//   returns    how many functions outside a type have a return type (attached.return_types)
// usage: node facts.mjs     (reads ../rows.classified.json, writes ../rows.facts.json)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { roots, ts, parse } from "./roots.mjs";
const require = createRequire(import.meta.url);
const erased = require("./erased.cjs");
const wrappers = require("/workspace/notes/lint/units/parser/probes/p3-3-wrappers-and-parentheses/oracle.cjs");
const K = ts.SyntaxKind;
const here = new URL("..", import.meta.url).pathname;
const rows = JSON.parse(readFileSync(here + "rows.classified.json", "utf8"));

const TAG = {
  [K.VariableStatement]: "s_local", [K.ExpressionStatement]: "s_expr", [K.FunctionDeclaration]: "s_function", [K.ClassDeclaration]: "s_class",
  [K.EnumDeclaration]: "s_enum", [K.ModuleDeclaration]: "s_namespace", [K.ImportDeclaration]: "s_import", [K.ImportEqualsDeclaration]: "s_local",
  [K.Block]: "s_block", [K.SwitchStatement]: "s_switch", [K.ForOfStatement]: "s_for_of", [K.IfStatement]: "s_if", [K.WithStatement]: "s_with",
  [K.LabeledStatement]: "s_label", [K.ReturnStatement]: "s_return",
};
function tagOf(s) {
  if (s.kind === K.ExportDeclaration) return !s.moduleSpecifier ? "s_export_clause" : s.exportClause && s.exportClause.kind === K.NamedExports ? "s_export_from" : "s_export_star";
  if (s.kind === K.ExportAssignment) return s.isExportEquals ? "s_export_equals" : "s_export_default";
  const tag = TAG[s.kind];
  if (!tag) throw new Error("no tag for the statement " + K[s.kind]);
  return tag;
}
// A line of the oracle without what erased_tests.rs does not print.
function cut(line) {
  return line
    .replace(/ keyword=\w+/, "")
    .replace(/ default=\S+ star=\S+ items=\S+/, "")
    .replace(/ (items=\S+|star(-as=\S+)?)(?= path=)/, "")
    .replace(/ path=-/, "")
    .replace(/ (members|kind|params|kept-members|stmts|ref|key|open|body|decorators|attributes)=.*$/, "");
}
const WRAPPER = new Set([K.ParenthesizedExpression, K.AsExpression, K.SatisfiesExpression, K.NonNullExpression, K.TypeAssertionExpression]);
function nodesOf(sf) {
  const out = [];
  // Where Bun puts the node: a node that begins with its left operand starts where that operand does, inside its parentheses.
  const start = n => {
    while (WRAPPER.has(n.kind)) n = n.expression;
    if (n.kind === K.BinaryExpression) return start(n.left);
    if (n.kind === K.PropertyAccessExpression || n.kind === K.ElementAccessExpression || n.kind === K.CallExpression || n.kind === K.TaggedTemplateExpression) return start(n.kind === K.TaggedTemplateExpression ? n.tag : n.expression);
    if (n.kind === K.PostfixUnaryExpression) return start(n.operand);
    if (n.kind === K.ConditionalExpression) return start(n.condition);
    return n.getStart(sf);
  };
  let returns = 0;
  const insideType = n => { for (let p = n.parent; p; p = p.parent) if (ts.isTypeNode(p) && p.kind !== K.ExpressionWithTypeArguments) return true; return false; };
  const visit = n => {
    if (n.kind === K.ConditionalExpression) out.push([start(n), "e_if"]);
    else if (n.kind === K.ArrowFunction) out.push([n.getStart(sf), "e_arrow"]);
    else if (n.kind === K.CallExpression && n.expression.kind !== K.ImportKeyword) out.push([start(n), "e_call"]);
    else if (n.kind === K.PropertyDeclaration && (n.modifiers ?? []).some(m => m.kind === K.AccessorKeyword)) out.push([n.name.getStart(sf), "auto_accessor"]);
    if ((ts.isFunctionLike(n) && !ts.isTypeNode(n) && !ts.isTypeElement(n)) && n.type && !insideType(n)) returns++;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  out.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
  return { nodes: out.map(([at, tag]) => `${tag}@${at}`).join(" "), returns };
}
let n = 0;
for (const r of rows) {
  const loader = r.loader === "deco" ? "ts" : r.loader;
  const file = loader === "tsx" ? "/a.tsx" : loader === "js" ? "/a.js" : "/a.ts";
  const parsed = roots(r.src, loader);
  r.roots = parsed.roots;
  if (parsed.diagnostics.length > 0) {
    // tsc does not parse the source: its first diagnostic is what a strict parse reports.
    const [code, at, length, text] = parsed.diagnostics[0];
    r.reject = { code, start: at, end: at + length, text };
    continue;
  }
  const e = erased.run(r.src, file);
  const { nodes, returns } = nodesOf(parse(r.src, loader));
  r.facts = { kept: e.keptNodes.map(tagOf), erased: e.lines.map(cut), wrappers: wrappers.lines(file, r.src).out, nodes, returns };
  n++;
}
writeFileSync(here + "rows.facts.json", JSON.stringify(rows));
console.log(`${rows.length} rows: ${n} with facts, ${rows.length - n} that tsc does not parse`);
