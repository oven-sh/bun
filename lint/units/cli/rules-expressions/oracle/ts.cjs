// Research scratch: ESLint at the pin with the parser of typescript-eslint over snippets given as arguments or a JSON array file.
"use strict";
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const parser = require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const rule = process.argv[2];
let codes = process.argv.slice(3);
if (codes.length === 1 && codes[0].endsWith(".json")) codes = JSON.parse(require("fs").readFileSync(codes[0], "utf8"));
for (const code of codes) {
	const tsx = code.startsWith("//tsx\n");
	const messages = linter.verify(code, [{ files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: tsx } }, sourceType: "module" }, rules: Object.fromEntries(rule.split(",").map(r => [r, "error"])) }], { filename: tsx ? "a.tsx" : "a.ts" });
	console.log(JSON.stringify(code) + "\n      => " + (messages.map(m => (m.fatal ? "FATAL " : "") + `${m.ruleId || ""} ${m.line}:${m.column} ${m.message}`).join(" | ") || "(none)"));
}
