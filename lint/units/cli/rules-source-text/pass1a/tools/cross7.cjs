// Among the seven rules and the eleven of round 1: which codes of ESLint's own test of one rule get a report of another (ESLint, default options).
"use strict";
const { execFileSync } = require("child_process");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
const seven = ["no-loss-of-precision", "no-octal", "no-nonoctal-decimal-escape", "no-irregular-whitespace", "no-unexpected-multiline", "no-empty", "no-empty-static-block"];
const eleven = ["no-debugger", "no-dupe-keys", "no-dupe-class-members", "no-duplicate-case", "no-empty-pattern", "no-compare-neg-zero", "use-isnan", "valid-typeof", "no-unsafe-negation", "no-sparse-arrays", "no-self-assign"];
const all = [...seven, ...eleven];
const verify = (code, st, jsx) => linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType: st, parserOptions: { ecmaFeatures: { jsx } } }, rules: Object.fromEntries(all.map(r => [r, "error"])) }]);
const table = {};
for (const rule of seven) {
  const codes = JSON.parse(execFileSync("node", ["/workspace/notes/lint/units/cli/round2-oracle/proto-1a/extract.cjs", rule, "--all"], { encoding: "utf8", maxBuffer: 1 << 28 })).filter(c => !c.ext);
  for (const c of codes) {
    let m = null;
    for (const [st, jsx] of [["script", false], ["module", false], ["script", true], ["module", true]]) { m = verify(c.code, st, jsx); if (!m.some(x => x.fatal)) break; }
    if (m.some(x => x.fatal)) continue;
    for (const other of new Set(m.map(x => x.ruleId))) if (other !== rule) { const k = `${rule} -> ${other}`; (table[k] = table[k] || []).push(c.code); }
  }
}
for (const [k, v] of Object.entries(table)) console.log(k, v.length, JSON.stringify(v.slice(0, 3)).slice(0, 160));
