// Prototype of no-self-assign as it is to be written on Bun's tree, on ESTree but seeing only what Bun's tree records:
// no ChainExpression (a member has an optional flag that the comparison ignores), a static name that is a string,
// a number, or the spelling of a decimal BigInt or of a regular expression.
const { Linter } = require("eslint");
const linter = new Linter();
const skip = n => n && n.type === "ChainExpression" ? n.expression : n;
function staticValue(n) {               // getStaticStringValue, as Bun's tree allows
  switch (n.type) {
    case "Literal":
      if (n.regex) return n.raw;                                   // E::RegExp.value
      if (n.bigint !== undefined) { const t = n.raw.slice(0, -1).replace(/_/g, ""); return /^0./.test(t) ? null : t; }
      return String(n.value);                                      // string: cooked; number: dtoa; true, false, null
    case "TemplateLiteral": return n.expressions.length === 0 && n.quasis.length === 1 ? n.quasis[0].value.cooked : null;
    default: return null;
  }
}
function staticName(n) {                 // getStaticPropertyName
  const prop = n.type === "MemberExpression" ? n.property : n.key;
  if (prop.type === "Identifier" && !n.computed) return prop.name;
  if (prop.type === "PrivateIdentifier") return null;
  return staticValue(prop);
}
function equalLiteral(l, r) {
  if (l.regex || r.regex) return !!(l.regex && r.regex) && l.raw === r.raw;
  if (l.bigint !== undefined || r.bigint !== undefined) return l.bigint !== undefined && r.bigint !== undefined && l.raw.replace(/_/g, "") === r.raw.replace(/_/g, "");
  return l.value === r.value;
}
function same(l, r) {                    // isSameReference
  l = skip(l); r = skip(r);
  if (l.type !== r.type) return false;
  switch (l.type) {
    case "Super": case "ThisExpression": return true;
    case "Identifier": case "PrivateIdentifier": return l.name === r.name;
    case "Literal": return equalLiteral(l, r);
    case "MemberExpression": {
      const name = staticName(l);
      if (name !== null) return same(l.object, r.object) && name === staticName(r);
      return l.computed === r.computed && same(l.object, r.object) && same(l.property, r.property);
    }
    default: return false;
  }
}
function each(left, right, report) {     // eachSelfAssignment
  if (!left || !right) return;
  if (left.type === "Identifier" && right.type === "Identifier" && left.name === right.name) return report(right);
  if (left.type === "ArrayPattern" && right.type === "ArrayExpression") {
    const end = Math.min(left.elements.length, right.elements.length);
    for (let i = 0; i < end; i++) {
      const l = left.elements[i], r = right.elements[i];
      if (l && l.type === "RestElement" && i < right.elements.length - 1) break;
      each(l, r, report);
      if (r && r.type === "SpreadElement") break;
    }
    return;
  }
  if (left.type === "RestElement" && right.type === "SpreadElement") return each(left.argument, right.argument, report);
  if (left.type === "ObjectPattern" && right.type === "ObjectExpression" && right.properties.length >= 1) {
    let start = 0;
    for (let i = right.properties.length - 1; i >= 0; i--) if (right.properties[i].type === "SpreadElement") { start = i + 1; break; }
    for (const l of left.properties) for (let j = start; j < right.properties.length; j++) {
      const r = right.properties[j];
      if (l.type !== "Property" || r.type !== "Property" || r.kind !== "init" || r.method) continue;
      const name = staticName(l);
      if (name !== null && name === staticName(r)) each(l.value, r.value, report);
    }
    return;
  }
  if (skip(left).type === "MemberExpression" && skip(right).type === "MemberExpression" && same(left, right)) report(right);
}
const rule = {
  meta: { schema: [], messages: { selfAssignment: "'{{name}}' is assigned to itself." } },
  create(context) {
    const sc = context.sourceCode;
    const report = node => context.report({ node, messageId: "selfAssignment", data: { name: sc.getText(node).replace(/\s+/gu, "") } });
    return { AssignmentExpression(node) { if (["=", "&&=", "||=", "??="].includes(node.operator)) each(node.left, node.right, report); } };
  },
};
function run(code, which) {
  const cfg = [{ plugins: { proto: { rules: { "no-self-assign": rule } } }, languageOptions: { ecmaVersion: "latest", sourceType: "script" }, rules: { [which]: "error" } }];
  // What is printed is sorted and each line once.
  const lines = linter.verify(code, cfg).map(m => m.fatal ? "FATAL " + m.message : `${m.line}:${m.column} ${m.message}`);
  return lines;
}
let same_ = 0; const differ = [];
for (const file of process.argv.slice(2)) for (const code of JSON.parse(require("fs").readFileSync(file, "utf8"))) {
  const eslint = run(code, "no-self-assign"), ours = [...new Set(run(code, "proto/no-self-assign"))];
  if (eslint[0]?.startsWith("FATAL")) continue;
  if (eslint.join("|") === ours.join("|")) same_++; else differ.push([code, eslint, ours]);
}
console.log(`same answer: ${same_}; different: ${differ.length}`);
for (const [code, e, o] of differ) console.log(`  ${JSON.stringify(code)}\n      eslint     ${e.join(" | ") || "(none)"}\n      structural ${o.join(" | ") || "(none)"}`);
