// Prototype of the planned no-irregular-whitespace (default options): candidates from the bytes, minus those that start in a string literal.
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs"); const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const espree = require("/workspace/ref/eslint/node_modules/espree");
const linter = new Linter({ configType: "flat" });
const cfgOf = (st, jsx) => [{ languageOptions: { ecmaVersion: "latest", sourceType: st, parserOptions: { ecmaFeatures: { jsx } } }, rules: { "no-irregular-whitespace": "error" } }];
function eslint(code) {
  for (const [st, jsx] of [["script", false], ["module", false], ["script", true], ["module", true]]) {
    const m = linter.verify(code, cfgOf(st, jsx));
    if (!m.some(x => x.fatal)) return { st, jsx, reports: m.map(x => `${x.line}:${x.column}`).sort() };
  }
  return null;
}
// byte-level candidates as the plan says: runs of the 22 characters, and each U+2028 / U+2029 alone. Offsets are UTF-8 bytes.
function candidates(buf) {
  const out = []; let i = 0; let run = -1;
  const irregular = i => {
    const b = buf[i];
    if (b === 0x0b || b === 0x0c) return 1;
    if (b === 0xc2 && (buf[i + 1] === 0x85 || buf[i + 1] === 0xa0)) return 2;
    if (b === 0xe1 && ((buf[i + 1] === 0x9a && buf[i + 2] === 0x80) || (buf[i + 1] === 0xa0 && buf[i + 2] === 0x8e))) return 3;
    if (b === 0xe2 && buf[i + 1] === 0x80 && ((buf[i + 2] >= 0x80 && buf[i + 2] <= 0x8b) || buf[i + 2] === 0xaf)) return 3;
    if (b === 0xe2 && buf[i + 1] === 0x81 && buf[i + 2] === 0x9f) return 3;
    if (b === 0xe3 && buf[i + 1] === 0x80 && buf[i + 2] === 0x80) return 3;
    if (b === 0xef && buf[i + 1] === 0xbb && buf[i + 2] === 0xbf) return 3;
    return 0;
  };
  while (i < buf.length) {
    const n = irregular(i);
    if (n) { if (run < 0) { run = i; out.push(i); } i += n; continue; }
    run = -1;
    if (buf[i] === 0xe2 && buf[i + 1] === 0x80 && (buf[i + 2] === 0xa8 || buf[i + 2] === 0xa9)) { out.push(i); i += 3; continue; }
    i += 1;
  }
  return out;
}
// line and column as `bun --lint` prints them: ECMAScript line starts, columns in UTF-16 units, 1-based.
function lineCol(text, charIndex) {
  let line = 1, start = 0;
  for (let i = 0; i < charIndex; i++) {
    const c = text[i];
    if (c === "\r") { if (text[i + 1] === "\n" && i + 1 < charIndex) i++; line++; start = i + 1; }
    else if (c === "\n" || c === "\u2028" || c === "\u2029") { line++; start = i + 1; }
  }
  return `${line}:${charIndex - start + 1}`;
}
function planned(code, st, jsx) {
  const text = code.charCodeAt(0) === 0xfeff ? code.slice(1) : code;   // the BOM is dropped when the file is read
  const buf = Buffer.from(text, "utf8");
  const cands = candidates(buf);
  if (!cands.length) return [];
  // string literals: ranges in UTF-16 indexes from the tree of espree (stands for the lexer and the tree of Bun)
  const ast = espree.parse(text, { ecmaVersion: "latest", sourceType: st, ecmaFeatures: { jsx }, range: true });
  const ranges = [];
  (function walk(n) { if (!n || typeof n !== "object") return; if (Array.isArray(n)) return n.forEach(walk); if (n.type === "Literal" && typeof n.value === "string") ranges.push(n.range); for (const k in n) if (k !== "parent") walk(n[k]); })(ast);
  // byte offset -> UTF-16 index
  const idx = off => buf.subarray(0, off).toString("utf8").length;
  return cands.map(idx).filter(i => !ranges.some(([s, e]) => i >= s && i < e)).map(i => lineCol(text, i)).sort();
}
const codes = new Set();
for (const c of JSON.parse(execFileSync("node", ["/workspace/notes/lint/units/cli/round2-oracle/proto-1a/extract.cjs", "no-irregular-whitespace", "--all"], { encoding: "utf8", maxBuffer: 1 << 28 }))) codes.add(c.code);
const dir = "/workspace/wt/cli/test/cli/lint/rules";
for (const f of fs.readdirSync(dir)) for (const c of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) codes.add(c.code);
for (const c of require("../cases/no-irregular-whitespace.cjs")) if (!c.ext) codes.add(c.code);
let n = 0, bad = 0, withReports = 0, rejected = 0;
for (const code of codes) {
  const e = eslint(code); if (!e) { rejected++; continue; }
  let p; try { p = planned(code, e.st, e.jsx); } catch (err) { console.log("ERR", JSON.stringify(code), err.message); continue; }
  n++; if (e.reports.length) withReports++;
  // ESLint says a report once per error; two errors at one start cannot happen
  if (JSON.stringify(p) !== JSON.stringify(e.reports)) { bad++; if (bad <= 15) console.log("DIFF", JSON.stringify(code), "eslint", e.reports.join(" "), "| planned", p.join(" ")); }
}
console.log({ compared: n, withReports, differences: bad, rejected });
