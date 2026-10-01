// Prototype of the planned scan of no-nonoctal-decimal-escape over the raw text of a string literal, compared with ESLint (script).
"use strict";
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
const cfg = jsx => [{ languageOptions: { ecmaVersion: "latest", sourceType: "script", parserOptions: { ecmaFeatures: { jsx } } }, rules: { "no-nonoctal-decimal-escape": "error" } }];
// planned: bytes of the literal with its quotes; a backslash takes the byte after it; `\8` and `\9` are reported where the backslash is
function planned(raw) {
  const out = [];
  for (let i = 0; i < raw.length; ) {
    if (raw[i] !== 0x5c) { i += 1; continue; }
    if (raw[i + 1] === 0x38 || raw[i + 1] === 0x39) out.push([i, String.fromCharCode(raw[i + 1])]);
    i += 2;
  }
  return out;
}
let seed = 4242; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const atoms = ["\\8", "\\9", "\\\\", "8", "9", "\\0", "\\n", "a", " ", "\\\n", "\\\r\n", "\\x38", "\\u0038", "\\👍", "👍", "\\1", "\\7", "é", "\\é", "\\'", "\\\""];
let n = 0, bad = 0, rej = 0;
for (let t = 0; t < 3000; t++) {
  const q = rnd(2) ? "'" : '"';
  let body = ""; for (let k = rnd(7); k > 0; k--) body += atoms[rnd(atoms.length)];
  const literal = q + body + q;
  const code = `x = ${literal};`;
  const m = linter.verify(code, cfg(false));
  if (m.some(x => x.fatal)) { rej++; continue; }
  const raw = Buffer.from(literal, "utf8");
  // byte offset in the literal -> column of the file (UTF-16 units), 1-based; the literal starts at column 5
  const col = off => 5 + raw.subarray(0, off).toString("utf8").length;
  // a line continuation moves what follows to another line: compare offsets through ESLint's own line and column
  const lines = code.split(/\r\n|[\r\n\u2028\u2029]/);
  const toLineCol = off => { let idx = 4 + raw.subarray(0, off).toString("utf8").length; let line = 1; let i = 0; const re = /\r\n|[\r\n\u2028\u2029]/g; let mm; let start = 0; while ((mm = re.exec(code)) && mm.index < idx) { line++; start = mm.index + mm[0].length; } return `${line}:${idx - start + 1}`; };
  const p = planned(raw).map(([off, d]) => `${toLineCol(off)} Don't use '\\${d}' escape sequence.`).sort();
  const e = m.map(x => `${x.line}:${x.column} ${x.message}`).sort();
  n++;
  if (JSON.stringify(p) !== JSON.stringify(e)) { bad++; if (bad <= 10) console.log("DIFF", JSON.stringify(code), e, p); }
}
// JSX attribute strings: no escapes, the literal ends at the first quote of its kind
for (const body of ["\\8", "a\\8b\\9", "\\\\8", "\\", "a\\", "\\8\\"]) {
  const code = `x = <a b="${body}"/>;`;
  const m = linter.verify(code, cfg(true));
  const raw = Buffer.from(`"${body}"`, "utf8");
  const p = planned(raw).map(([off, d]) => `1:${10 + off} Don't use '\\${d}' escape sequence.`).sort();
  const e = m.map(x => (x.fatal ? "FATAL " : "") + `${x.line}:${x.column} ${x.message}`).sort();
  n++; if (JSON.stringify(p) !== JSON.stringify(e)) { bad++; console.log("DIFF jsx", JSON.stringify(code), e, p); }
}
console.log({ compared: n, differences: bad, rejectedByEslint: rej });
