// Checks the derivation that test/cli/lint/regexpp.test.ts is to make from literal.txt against ESLint at the pin:
// every case of ecmaVersion 2025, not strict, whose literal splits into a pattern and valid flags becomes one line
// `new RegExp("<pattern>", "<flags>");`, and the expectation of the line is derived from the baseline alone.
// usage: node check-rule-from-literal.cjs <literal.txt> [test262.txt ...]
"use strict";
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint");
const dec = s => s.replace(/%u([0-9a-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const lit = s => { let r = '"'; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); r += c >= 0x20 && c <= 0x7e && c !== 0x22 && c !== 0x5c ? s[i] : "\\u" + c.toString(16).padStart(4, "0"); } return r + '"'; };
const isLineTerminator = c => c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029;
// `extractPatternAndFlags` of upstream's test/parser.ts, with the flags of ES2025.
function extract(source) {
  let inClass = false, escaped = false;
  const chars = [...source];
  if (chars[0] !== "/") return null;
  chars.shift();
  const pattern = [];
  let first = true;
  for (;;) {
    const char = chars.shift();
    if (!char) return null;
    const cp = char.charCodeAt(0);
    if (isLineTerminator(cp)) return null;
    if (escaped) escaped = false;
    else if (cp === 0x5c) escaped = true;
    else if (cp === 0x5b) inClass = true;
    else if (cp === 0x5d) inClass = false;
    else if (cp === 0x2a && first) return null;
    else if (cp === 0x2f && !inClass) break;
    pattern.push(char);
    first = false;
  }
  const flags = chars.join("");
  if (pattern.length === 0) return null;
  if (!/^[dgimsuvy]*$/.test(flags) || new Set(flags).size !== flags.length) return null;
  return { pattern: pattern.join(""), flags };
}
const program = [], expected = []; let skipped = 0;
for (const line of process.argv.slice(2).flatMap(f => fs.readFileSync(f, "utf8").split("\n"))) {
  if (!line || line.startsWith("#")) continue;
  const [kind, ecma, strict, source, a, b] = line.split("\t");
  if (ecma !== "2025" || strict !== "0") continue;
  const parts = extract(dec(source));
  if (!parts) { skipped++; continue; }
  program.push(`new RegExp(${lit(parts.pattern)}, ${lit(parts.flags)});`);
  if (parts.flags.includes("u") && parts.flags.includes("v")) expected.push("Regex 'u' and 'v' flags cannot be used together.");
  else if (kind === "E") expected.push(dec(b).replace(/\/([a-z]+?):/u, (_, f) => `/${f.replace(/[^uv]/gu, "")}:`) + ".");
  else expected.push(null);
}
const messages = new Linter().verify(program.join("\n"), { languageOptions: { ecmaVersion: "latest", sourceType: "script" }, rules: { "no-invalid-regexp": "error" } });
const got = program.map(() => null);
for (const m of messages) { if (m.ruleId !== "no-invalid-regexp" || m.column !== 1) { console.log("unexpected", m); process.exit(1); } got[m.line - 1] = m.message; }
let wrong = 0;
for (let i = 0; i < program.length; i++) if (got[i] !== expected[i]) { if (wrong++ < 10) console.log({ line: program[i], eslint: got[i], derived: expected[i] }); }
console.log({ lines: program.length, reports: messages.length, skipped, wrong, bytes: program.join("\n").length });
