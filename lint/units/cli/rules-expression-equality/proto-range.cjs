// Prototype of the range and name computation, fed with what Bun's tree has: the start of the leftmost token of each
// node (inside any parentheses), the start of a property name, and the kind of each leaf. Compared with ESLint's range.
const espree = require("espree");
const { Linter } = require("eslint");

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
function identifierEnd(s, at) {
  if (s[at] === "#") at++;
  for (;;) {
    const c = s[at];
    if (c === undefined) return at;
    if (c === "\\") { if (s[at + 1] === "u" && s[at + 2] === "{") { const e = s.indexOf("}", at); at = e + 1; } else at += 6; continue; }
    if (/[\p{ID_Continue}$\u200c\u200d]/u.test(c)) { at++; continue; }
    return at;
  }
}
function quotedEnd(s, at) {
  const q = s[at]; let i = at + 1;
  for (;;) { const c = s[i]; if (c === undefined) return null; if (c === "\\") i += 2; else if (c === q) return i + 1; else i++; }
}
function numericEnd(s, at) {
  let i = at;
  const alnum = c => c !== undefined && /[0-9A-Za-z_]/.test(c);
  const digit = c => c !== undefined && /[0-9_]/.test(c);
  if (s[i] === "0" && /[xXoObB]/.test(s[i + 1] ?? "")) { i += 2; while (alnum(s[i])) i++; return i; }
  while (digit(s[i])) i++;
  if (s[i] === ".") { i++; while (digit(s[i])) i++; }
  if (/[eE]/.test(s[i] ?? "") && (/[0-9]/.test(s[i + 1] ?? "") || (/[+-]/.test(s[i + 1] ?? "") && /[0-9]/.test(s[i + 2] ?? "")))) { i += 2; while (digit(s[i])) i++; }
  if (s[i] === "n") i++;
  return i;
}
// Bun-like start: the first token of the leftmost leaf.
function bunLoc(node) {
  switch (node.type) {
    case "ChainExpression": return bunLoc(node.expression);
    case "MemberExpression": return bunLoc(node.object);
    default: return node.range[0];
  }
}
function range(s, node) {
  if (node.type === "ChainExpression") node = node.expression;
  const start = bunLoc(node);
  switch (node.type) {
    case "Identifier": case "PrivateIdentifier": return { start, end: identifierEnd(s, start), missing: 0 };
    case "ThisExpression": return { start, end: start + 4, missing: 0 };
    case "Super": return { start, end: start + 5, missing: 0 };
    case "TemplateLiteral": { const end = quotedEnd(s, start); return end === null ? null : { start, end, missing: 0 }; }
    case "Literal": {
      if (node.regex) return { start, end: start + node.raw.length, missing: 0 };   // E::RegExp keeps its text
      if (node.value === null) return { start, end: start + 4, missing: 0 };
      if (typeof node.value === "boolean") return { start, end: start + (node.value ? 4 : 5), missing: 0 };
      if (typeof node.value === "string") { const end = quotedEnd(s, start); return end === null ? null : { start, end, missing: 0 }; }
      return { start, end: numericEnd(s, start), missing: 0 };
    }
    case "MemberExpression": {
      const target = range(s, node.object);
      if (!target) return null;
      const opened = withParentheses(s, target);
      if (!node.computed) {
        const nameLoc = node.property.range[0];
        return { start: opened.start, end: identifierEnd(s, nameLoc), missing: opened.missing };
      }
      const index = range(s, node.property);
      if (!index) return null;
      let at = index.end;
      for (;;) {
        at = skipTrivia(s, at);
        if (s[at] === ")") { at++; continue; }
        if (s[at] === "]") return { start: opened.start, end: at + 1, missing: opened.missing };
        return null;
      }
    }
    default: return null;
  }
}
function withParentheses(s, target) {
  let { start, end, missing } = target;
  let at = end;
  for (;;) {
    at = skipTrivia(s, at);
    if (s[at] !== ")") return { start, missing };
    at++;
    if (missing > 0) { missing++; continue; }
    let before = start;
    while (before > 0 && isWs(s.charCodeAt(before - 1))) before--;
    if (before > 0 && s[before - 1] === "(") start = before - 1; else missing++;
  }
}
function name(s, r) { return "(".repeat(r.missing) + s.slice(r.start, r.end).replace(/\s+/gu, ""); }

const linter = new Linter();
const cases = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
let bad = 0, checked = 0;
for (const code of cases) {
  let ast;
  try { ast = espree.parse(code, { ecmaVersion: "latest", range: true, loc: true }); } catch { continue; }
  const msgs = linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType: "script" }, rules: { "no-self-assign": "error" } }]);
  // Find every node ESLint reported: match by position.
  const reported = [];
  (function walk(n) {
    if (!n || typeof n.type !== "string") return;
    for (const m of msgs) if (n.loc.start.line === m.line && n.loc.start.column + 1 === m.column && n.loc.end.line === m.endLine && n.loc.end.column + 1 === m.endColumn
      && ["Identifier", "MemberExpression", "ChainExpression"].includes(n.type)) reported.push([n, m]);
    for (const k of Object.keys(n)) { if (k === "parent") continue; const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") walk(v); }
  })(ast);
  const seen = new Set();
  for (const [n, m] of reported) {
    const key = n.range.join(",") + m.message; if (seen.has(key)) continue; seen.add(key);
    // A ChainExpression and its MemberExpression share a range: take either.
    const r = range(code, n);
    checked++;
    const expectedName = /^'(.*)' is assigned to itself\.$/s.exec(m.message)[1];
    if (!r || r.start !== n.range[0] || r.end !== n.range[1] || name(code, r) !== expectedName) {
      bad++;
      console.log("MISMATCH", JSON.stringify(code), "eslint", n.range, JSON.stringify(expectedName), "ours", r && [r.start, r.end, r.missing], r && JSON.stringify(name(code, r)));
    }
  }
}
console.log(`checked ${checked} reported nodes, ${bad} mismatches`);
