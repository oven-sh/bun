// Prototype of the search for the `case` keyword, fed with what Bun's tree has: the start of the leftmost token of the
// test (inside any parentheses) and a floor. Compared with the start of ESLint's SwitchCase.
const espree = require("espree");
function isWs(c) { return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c; }
function skipTrivia(s, at) {
  for (;;) {
    const c = s.charCodeAt(at);
    if (isWs(c) || c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029) { at++; continue; }
    if (c === 0x2f && s[at + 1] === "/") { while (at < s.length && !"\n\r\u2028\u2029".includes(s[at])) at++; continue; }
    if (c === 0x2f && s[at + 1] === "*") { const e = s.indexOf("*/", at + 2); if (e < 0) return s.length; at = e + 2; continue; }
    return at;
  }
}
function onlyTriviaAndOpenParens(s, from, to) {
  let at = from;
  for (;;) {
    at = skipTrivia(s, at);
    if (at >= to) return at === to;
    if (s[at] !== "(") return false;
    at++;
  }
}
function caseKeywordStart(s, floor, test) {
  let from = floor;
  for (;;) {
    const at = s.indexOf("case", from);
    if (at < 0 || at + 4 > test) return null;
    const before = at === 0 ? "" : s[at - 1];
    const boundary = before === "" || !/[0-9A-Za-z_$\\\u0080-\uffff]/.test(before);
    if (boundary && onlyTriviaAndOpenParens(s, at + 4, test)) return at;
    from = at + 1;
  }
}
function bunLoc(n) {
  switch (n.type) {
    case "BinaryExpression": case "LogicalExpression": case "AssignmentExpression": return bunLoc(n.left);
    case "MemberExpression": return bunLoc(n.object);
    case "CallExpression": return bunLoc(n.callee);
    case "ConditionalExpression": return bunLoc(n.test);
    case "SequenceExpression": return bunLoc(n.expressions[0]);
    case "TaggedTemplateExpression": return bunLoc(n.tag);
    case "ChainExpression": return bunLoc(n.expression);
    case "UpdateExpression": return n.prefix ? n.range[0] : bunLoc(n.argument);
    default: return n.range[0];
  }
}
let checked = 0, bad = 0;
for (const file of process.argv.slice(2)) {
  for (const c of JSON.parse(require("fs").readFileSync(file, "utf8"))) {
    const code = typeof c === "string" ? c : c.code;
    let ast;
    try { ast = espree.parse(code, { ecmaVersion: "latest", range: true, sourceType: c.sourceType ?? "script", ecmaFeatures: { jsx: !!c.jsx } }); } catch { continue; }
    (function walk(n) {
      if (!n || typeof n.type !== "string") return;
      if (n.type === "SwitchStatement") {
        // Bun: body_loc is the `{`.
        let floor = code.indexOf("{", n.discriminant.range[1]) + 1;
        for (const k of n.cases) {
          if (k.test) {
            const test = bunLoc(k.test);
            const found = caseKeywordStart(code, floor, test);
            checked++;
            if (found !== k.range[0]) { bad++; console.log("MISMATCH", JSON.stringify(code), "eslint", k.range[0], "ours", found, "floor", floor, "test", test); }
            floor = test;
          }
          if (k.consequent.length) floor = k.consequent[k.consequent.length - 1].range[0];
        }
      }
      for (const key of Object.keys(n)) { const v = n[key]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") walk(v); }
    })(ast);
  }
}
console.log(`checked ${checked} case clauses, ${bad} mismatches`);
