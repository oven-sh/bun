// Prototype of the fallback that finds the backtick of a tagged template without a place in the tree:
// the (k+1)th template start, not inside a bracket opened since the scan began, after the last place M that the tag knows.
"use strict";
const espree = require("/workspace/ref/eslint/node_modules/espree");
const rnd = require("./rng.cjs")(5);
const pick = a => a[rnd(a.length)];
// what Bun's tree knows inside an expression: the own first token of every node, the name of a member, the `)` of a call, each `}` that starts a template tail
function last(node, acc) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(n => last(n, acc));
  if (typeof node.type !== "string") return;
  switch (node.type) {
    case "TemplateLiteral": acc.max(node.range[0]); for (const q of node.quasis.slice(1)) acc.max(q.range[0]); last(node.expressions, acc); return;
    case "TaggedTemplateExpression": last(node.tag, acc); for (const q of node.quasi.quasis.slice(1)) acc.max(q.range[0]); last(node.quasi.expressions, acc); return;   // the head has no place
    case "MemberExpression": last(node.object, acc); if (node.computed) last(node.property, acc); else acc.max(node.property.range[0]); return;
    case "CallExpression": last(node.callee, acc); last(node.arguments, acc); acc.max(node.range[1] - 1); return;
    case "NewExpression": acc.max(node.range[0]); last(node.callee, acc); last(node.arguments, acc); if (acc.text[node.range[1] - 1] === ")" && node.range[1] - 1 > node.callee.range[1] - 1) acc.max(node.range[1] - 1); return;
    case "FunctionExpression": acc.max(node.range[0]); last(node.params, acc); acc.max(node.body.range[0]); return;   // the body stands in braces
    case "ArrowFunctionExpression": acc.max(node.range[0]); last(node.params, acc); if (node.body.type === "BlockStatement") acc.max(node.body.range[0]); else last(node.body, acc); return;
    case "ClassExpression": acc.max(node.range[0]); last(node.superClass, acc); acc.max(node.body.range[0]); return;
    default: acc.max(own(node)); for (const k in node) if (k !== "parent" && k !== "range" && k !== "loc") last(node[k], acc);
  }
}
// the own first token: ESTree starts a node at the `(` of its first operand, Bun after it
function own(node) {
  switch (node.type) {
    case "MemberExpression": return own(node.object);
    case "CallExpression": return own(node.callee);
    case "TaggedTemplateExpression": return own(node.tag);
    case "BinaryExpression": case "LogicalExpression": case "AssignmentExpression": return own(node.left);
    case "SequenceExpression": return own(node.expressions[0]);
    case "ConditionalExpression": return own(node.test);
    case "UpdateExpression": return node.prefix ? node.range[0] : own(node.argument);
    default: return node.range[0];
  }
}
// how many templates without a substitution end the tag one after the other
function trailing(tag) {
  let k = 0;
  for (let e = tag; ; ) {
    switch (e.type) {
      case "TaggedTemplateExpression": if (e.quasi.expressions.length) return k; k++; e = e.tag; break;
      case "BinaryExpression": case "LogicalExpression": case "AssignmentExpression": e = e.right; break;
      case "SequenceExpression": e = e.expressions[e.expressions.length - 1]; break;
      case "UnaryExpression": case "AwaitExpression": case "SpreadElement": e = e.argument; break;
      case "UpdateExpression": e = e.argument; break;
      case "ConditionalExpression": e = e.alternate; break;
      case "NewExpression": if (NEWPAREN(e)) return k; e = e.callee; break;
      case "ArrowFunctionExpression": if (e.body.type === "BlockStatement") return k; e = e.body; break;
      case "ImportExpression": e = e.source; break;
      case "YieldExpression": if (!e.argument) return k; e = e.argument; break;
      default: return k;
    }
  }
}
let TEXT = "";
const NEWPAREN = e => TEXT[e.range[1] - 1] === ")" && e.range[1] - 1 >= e.callee.range[1];
function find(text, tokens, node) {
  TEXT = text;
  const acc = { text, at: -1, max(x) { if (x > this.at) this.at = x; } };
  last(node.tag, acc);
  let k = trailing(node.tag);
  const from = own(node.tag);
  let depth = 0;
  for (const t of tokens) {
    if (t.range[0] < from) continue;
    if (t.type === "Punctuator") { if ("[{".includes(t.value)) depth++; else if ("]}".includes(t.value)) depth--; continue; }
    if (t.type === "Template") {
      // a piece of a template that starts with `}` closes a substitution: the `${` before it opened it
      if (t.value[0] === "}") depth--;
      const starts = t.value[0] === "`";
      if (starts && depth <= 0 && t.range[0] > acc.at) { if (k === 0) return t.range[0]; k--; }
      if (t.value.endsWith("${")) depth++;
    }
  }
  return null;
}
const tags = ["(function(a = g`i`){})", "((a = g`i`) => {})", "((a = g`i`) => a)", "(class extends g`i` {})", "(() => (g`i`))", "(() => ({ a: g`i` }))", "new F", "(new F)", "(new (g`i`))", "(new g`i`)", "(a, (b, g`i`))", "(x = g`i`)", "(a ? b : (g`i`))", "f(g`i`)`j`", "f[g`i`]`j`", "(a + b`q``r`)", "f", "(f)", "f.g", "f()", "f[0]", "f`t`", "f`t``u`", "a?.b.c", "(f\n)", "`u`", "f`a${1}b`", "(a, b)", "(a + b`q`)", "(a + (b`q`))", "(x ? y : z`q`)", "(!z`q`)", "f(`i`)", "f[`i`]", "f(g`i`)", "(function(){ return g`i` })", "(() => g`i`)", "(()=>{ g`i` })", "[g`i`]", "({ a: g`i` })", "f`${g`i`}`", "f`a${b}c`.d", "(f`t`)", "((f`t`)`u`)", "new F()", "f(`a${`b`}`)", "(a, b`q``r`)", "f`x``y${1}z`"];
const quasis = ["`x`", "`x${1}y`", "`x\r\ny`", "``", "`${a`n`}`"];
let n = 0, bad = 0, none = 0;
for (let i = 0; i < 20000; i++) {
  let code = pick(tags); const m = 1 + rnd(3);
  for (let j = 0; j < m; j++) code += pick(["", " ", "\n", "/* ` */"]) + pick(quasis);
  code = "y = " + code + ";";
  let ast; try { ast = espree.parse(code, { ecmaVersion: "latest", range: true, tokens: true }); } catch { continue; }
  (function walk(x) {
    if (!x || typeof x !== "object") return; if (Array.isArray(x)) return x.forEach(walk);
    if (x.type === "TaggedTemplateExpression") { n++; const got = find(code, ast.tokens, x); if (got === null) none++; else if (got !== x.quasi.range[0]) { bad++; if (bad < 12) console.log("WRONG", JSON.stringify(code), "got", got, "want", x.quasi.range[0]); } }
    for (const k in x) if (k !== "tokens") walk(x[k]);
  })(ast.body);
}
console.log({ templates: n, wrong: bad, notFound: none });
