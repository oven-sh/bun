// How many cases of the fixtures in the tree get a report of each of the seven rules from ESLint (script, then module, as round 1 read them).
"use strict";
const fs = require("fs"); const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
const rules = ["no-loss-of-precision", "no-octal", "no-nonoctal-decimal-escape", "no-irregular-whitespace", "no-unexpected-multiline", "no-empty", "no-empty-static-block"];
const dir = "/workspace/wt/cli/test/cli/lint/rules";
const verify = (code, st, jsx) => linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType: st, parserOptions: { ecmaFeatures: { jsx } } }, rules: Object.fromEntries(rules.map(r => [r, "error"])) }]);
const tally = {}; const perFixture = {}; const seen = new Set(); let total = 0, fatal = 0;
const examples = {};
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json"))) {
  for (const c of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) {
    const key = (c.jsx ? "jsx:" : "js:") + c.code; if (seen.has(key)) continue; seen.add(key); total++;
    let m = null;
    for (const [st, jsx] of [["script", !!c.jsx], ["module", !!c.jsx], ["script", true], ["module", true]]) { m = verify(c.code, st, jsx); if (!m.some(x => x.fatal)) break; }
    if (m.some(x => x.fatal)) { fatal++; continue; }
    for (const r of new Set(m.map(x => x.ruleId))) { tally[r] = (tally[r] || 0) + 1; (perFixture[r] = perFixture[r] || {})[f] = ((perFixture[r] || {})[f] || 0) + 1; (examples[r] = examples[r] || []).length < 3 && examples[r].push(c.code.slice(0, 70)); }
  }
}
console.log({ total, fatal, tally }); console.log(JSON.stringify(perFixture, null, 1)); console.log(JSON.stringify(examples, null, 1));
