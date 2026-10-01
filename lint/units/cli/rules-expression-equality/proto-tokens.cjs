// Prototype of the structural stand-in for equalTokens, on ESTree but seeing only what Bun's tree records:
// no parentheses except a flag on array and object literals, no trailing commas, cooked identifier names,
// leaves compared by their source text; a function, a class or JSX never equals anything.
const { Linter } = require("eslint");
const linter = new Linter();

function makeRule() {
  return {
    meta: { schema: [], messages: { unexpected: "Duplicate case label." } },
    create(context) {
      const sc = context.sourceCode;
      const parenthesized = n => {
        const b = sc.getTokenBefore(n), a = sc.getTokenAfter(n);
        return !!(b && a && b.value === "(" && a.value === ")" && b.type === "Punctuator" && a.type === "Punctuator");
      };
      const raw = n => sc.getText(n);
      function list(a, b, f) { return a.length === b.length && a.every((x, i) => f(x, b[i])); }
      function opt(a, b) { return a === null || b === null ? a === b : eq(a, b, true); }
      // What Bun's optional_chain says of a member or call: "start", "continuation" or "none".
      function chainOf(n, inChain) { return n.optional ? "start" : inChain ? "continuation" : "none"; }
      function eq(a, b, nested, chainA = false, chainB = false) {
        if (a.type === "ChainExpression") return b.type === "ChainExpression" && eq(a.expression, b.expression, true, true, true);
        if (a.type !== b.type) return false;
        switch (a.type) {
          case "Identifier": case "PrivateIdentifier": return a.name === b.name;
          case "ThisExpression": case "Super": return true;
          case "MetaProperty": return a.meta.name === b.meta.name && a.property.name === b.property.name;
          case "Literal": return raw(a) === raw(b);
          case "TemplateLiteral": return list(a.quasis, b.quasis, (x, y) => x.value.raw === y.value.raw) && list(a.expressions, b.expressions, (x, y) => eq(x, y, true));
          case "TaggedTemplateExpression": return eq(a.tag, b.tag, true) && eq(a.quasi, b.quasi, true);
          case "UnaryExpression": case "UpdateExpression": return a.operator === b.operator && a.prefix === b.prefix && eq(a.argument, b.argument, true);
          case "BinaryExpression": case "LogicalExpression": case "AssignmentExpression": return a.operator === b.operator && eq(a.right, b.right, true) && eq(a.left, b.left, true);
          case "SequenceExpression": {
            // Bun: a left-deep chain of comma operators, so `(a, b), c` is `a, b, c`.
            const flat = n => n.expressions.flatMap((e, i) => i === 0 && e.type === "SequenceExpression" ? flat(e) : [e]);
            return list(flat(a), flat(b), (x, y) => eq(x, y, true));
          }
          case "ConditionalExpression": return eq(a.test, b.test, true) && eq(a.consequent, b.consequent, true) && eq(a.alternate, b.alternate, true);
          case "MemberExpression": {
            if (a.computed !== b.computed || chainOf(a, chainA) !== chainOf(b, chainB)) return false;
            const inA = chainA || a.optional, inB = chainB || b.optional;
            return eq(a.property, b.property, true) && eq(a.object, b.object, true, inA && a.object.type !== "ChainExpression", inB && b.object.type !== "ChainExpression");
          }
          case "CallExpression": {
            if (chainOf(a, chainA) !== chainOf(b, chainB)) return false;
            const inA = chainA || a.optional, inB = chainB || b.optional;
            return list(a.arguments, b.arguments, (x, y) => eq(x, y, true)) && eq(a.callee, b.callee, true, inA, inB);
          }
          case "NewExpression": {
            const parens = n => sc.getLastToken(n).value === ")" && sc.getLastToken(n).range[1] === n.range[1] && (n.arguments.length > 0 || sc.getTokenAfter(n.callee, { filter: t => t.value === "(" }) !== null && sc.getLastToken(n).value === ")" && sc.getText(n).trimEnd().endsWith(")") && !parenthesizedCalleeOnly(n));
            return parens(a) === parens(b) && eq(a.callee, b.callee, true) && list(a.arguments, b.arguments, (x, y) => eq(x, y, true));
          }
          case "ArrayExpression": return (!nested || parenthesized(a) === parenthesized(b)) && list(a.elements, b.elements, opt);
          case "ObjectExpression": return (!nested || parenthesized(a) === parenthesized(b)) && list(a.properties, b.properties, (x, y) => eq(x, y, true));
          case "Property": {
            if (a.kind !== b.kind || a.method !== b.method || a.computed !== b.computed || a.shorthand !== b.shorthand) return false;
            // Bun: a name that is not computed is a string, told from a quoted one by the first character of its text.
            const key = (x, y) => !a.computed && x.type !== y.type ? false : x.type === "Identifier" && !a.computed ? x.name === y.name : eq(x, y, true);
            return key(a.key, b.key) && eq(a.value, b.value, true);
          }
          case "SpreadElement": case "AwaitExpression": return eq(a.argument, b.argument, true);
          case "YieldExpression": return a.delegate === b.delegate && opt(a.argument, b.argument);
          case "ImportExpression": return eq(a.source, b.source, true) && opt(a.options ?? null, b.options ?? null);
          default: return false;   // FunctionExpression, ArrowFunctionExpression, ClassExpression, JSXElement, JSXFragment
        }
      }
      function parenthesizedCalleeOnly(n) {
        // `new (A)`: the last token is the `)` of the parentheses around the callee, not of an argument list.
        if (n.arguments.length > 0) return false;
        const after = sc.getTokenAfter(n.callee);
        const last = sc.getLastToken(n);
        let depth = 0;
        for (const t of sc.getTokens(n)) { if (t.range[0] < n.callee.range[0] && t.value === "(") depth++; }
        // Parentheses opened before the callee close after it: the one that is left, if any, is an argument list.
        let closing = 0;
        for (const t of sc.getTokens(n)) { if (t.range[0] >= n.callee.range[1] && t.value === ")") closing++; }
        return closing === depth;
      }
      return {
        SwitchStatement(node) {
          const previous = [];
          for (const c of node.cases) {
            if (!c.test) continue;
            if (previous.some(p => eq(p, c.test, false))) context.report({ node: c, messageId: "unexpected" });
            else previous.push(c.test);
          }
        },
      };
    },
  };
}
const plugin = { rules: { "no-duplicate-case": makeRule() } };
function run(code, c, which) {
  const cfg = [{
    plugins: { proto: plugin },
    languageOptions: { ecmaVersion: "latest", sourceType: c.sourceType ?? "script", parserOptions: { ecmaFeatures: { jsx: !!c.jsx } } },
    rules: { [which]: "error" },
  }];
  return linter.verify(code, cfg).map(m => m.fatal ? "FATAL " + m.message : `${m.line}:${m.column}`).join(",");
}
let same = 0; const differ = [];
for (const file of process.argv.slice(2)) {
  for (const c0 of JSON.parse(require("fs").readFileSync(file, "utf8"))) {
    const c = typeof c0 === "string" ? { code: c0 } : c0;
    const eslint = run(c.code, c, "no-duplicate-case"), ours = run(c.code, c, "proto/no-duplicate-case");
    if (eslint.startsWith("FATAL")) continue;
    if (eslint === ours) same++; else differ.push([c.code, eslint || "(none)", ours || "(none)"]);
  }
}
console.log(`same answer: ${same}; different: ${differ.length}`);
for (const [code, e, o] of differ) console.log(`  ${JSON.stringify(code)}\n      eslint ${e}   structural ${o}`);
