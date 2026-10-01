// usage: node probe.cjs <rule[,rule...]> <ext> <code>...   prints ESLint's reports with @typescript-eslint/parser (ts exts) or espree (js exts)
"use strict";
const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const tsParser = require("module").createRequire("/workspace/ref/tseslint/")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const [rules, ext, ...codes] = process.argv.slice(2);
const ruleList = rules.split(",");
for (const code of codes) {
  const isTs = /^(ts|tsx|mts|cts)$/.test(ext);
  const languageOptions = isTs
    ? { parser: tsParser, ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: ext === "tsx" } } }
    : { ecmaVersion: "latest", sourceType: ext === "cjs" ? "commonjs" : "module", parserOptions: { ecmaFeatures: { jsx: ext === "jsx" || ext === "js" } } };
  const messages = linter.verify(code, [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions, rules: Object.fromEntries(ruleList.map(r => [r, "error"])) }], { filename: `file.${ext}` });
  console.log(JSON.stringify(code));
  if (!messages.length) console.log("    (none)");
  for (const m of messages) console.log(`    ${m.fatal ? "FATAL " : ""}${m.line}:${m.column}-${m.endLine}:${m.endColumn} ${m.ruleId}: ${m.message}`);
}
