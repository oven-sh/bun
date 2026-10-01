// usage: node probe2.cjs <rule[,rule...]> <file.json>   cases: [{code, ext?, st?}] ; prints ESLint's reports
"use strict";
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const tsParser = require("module").createRequire("/workspace/ref/tseslint/")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const [rules, file] = process.argv.slice(2);
const ruleList = rules.split(",");
const cases = require(require("path").resolve(file));
for (const c of cases) {
  const ext = c.ext || "js";
  const isTs = /^(ts|tsx|mts|cts)$/.test(ext);
  const languageOptions = isTs
    ? { parser: tsParser, ecmaVersion: "latest", sourceType: c.st || "module", parserOptions: { ecmaFeatures: { jsx: ext === "tsx" } } }
    : { ecmaVersion: "latest", sourceType: c.st || "script", parserOptions: { ecmaFeatures: { jsx: ext === "jsx" } } };
  const messages = linter.verify(c.code, [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions, rules: Object.fromEntries(ruleList.map(r => [r, "error"])) }], { filename: `file.${ext}` });
  console.log(`[${ext}${c.st ? ":" + c.st : ""}] ` + JSON.stringify(c.code));
  if (!messages.length) console.log("    (none)");
  for (const m of messages) console.log(`    ${m.fatal ? "FATAL " : ""}${m.line}:${m.column}-${m.endLine}:${m.endColumn} ${m.ruleId}: ${m.message}`);
}
