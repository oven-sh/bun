// Research scratch: for every case of the given lists, the rules of <rules> that report on it by ESLint at the pin, at their
// default options. One JSON line per case and rule: { rule, from, code, jsx?, ext?, expect: [{ line, column, message }] }.
// A fixture of <rule> takes the lines of <rule>: rules.test.ts wants a case that gets a line of a rule in the fixture of that rule.
// usage: node cross-lists.cjs <rule[,rule]> <list.json>...
// A list: codes, or { code, jsx?, ext?, sourceType?, languageOptions? }, or { valid, invalid } of extract.cjs.
"use strict";
const fs = require("fs");
const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const tsParser = require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const names = process.argv[2].split(",");
const rules = Object.fromEntries(names.map(r => [r, "error"]));
const tally = {};
for (const file of process.argv.slice(3)) {
	const from = path.basename(file, ".json");
	const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
	for (const raw of Array.isArray(parsed) ? parsed : [...parsed.valid, ...parsed.invalid]) {
		const c = typeof raw === "string" ? { code: raw } : raw;
		const o = c.languageOptions || {};
		if (o.globals) continue;
		const jsx = !!(c.jsx || (o.parserOptions && o.parserOptions.ecmaFeatures && o.parserOptions.ecmaFeatures.jsx));
		const ext = c.ext || (jsx ? "jsx" : "js");
		let messages;
		if (ext === "ts" || ext === "tsx") {
			messages = linter.verify(c.code, [{ files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: ext === "tsx" } } }, rules }], { filename: "a." + ext });
		} else {
			const types = c.sourceType || o.sourceType ? [c.sourceType || o.sourceType] : ["script", "module"];
			for (const sourceType of types) {
				messages = linter.verify(c.code, [{ languageOptions: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } }, rules }]);
				if (!messages.some(m => m.fatal)) break;
			}
		}
		if (messages.some(m => m.fatal)) continue;
		for (const rule of new Set(messages.map(m => m.ruleId))) {
			tally[`${rule} <- ${from}`] = (tally[`${rule} <- ${from}`] || 0) + 1;
			const expect = messages.filter(m => m.ruleId === rule).map(m => ({ line: m.line, column: m.column, message: m.message }));
			console.log(JSON.stringify({ rule, from, code: c.code, ...(ext === "jsx" ? { jsx: true } : {}), ...(ext === "ts" || ext === "tsx" ? { ext } : {}), expect }));
		}
	}
}
for (const [k, n] of Object.entries(tally).sort()) console.error(k, n);
