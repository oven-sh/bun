// Research scratch. The cases of ../cases/td-{edge,ts}-<rule>.json on which another of the 17 rules reports, by ESLint at the pin
// (typescript-eslint's parser for a case with `ext`). usage: node cross-own.cjs [--json]
"use strict";
const path = require("path");
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const tsParser = require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const six = ["no-cond-assign", "no-constant-binary-expression", "no-constant-condition", "no-dupe-else-if", "no-extra-boolean-cast", "no-unsafe-optional-chaining"];
const eleven = ["no-debugger", "no-dupe-keys", "no-dupe-class-members", "no-duplicate-case", "no-empty-pattern", "no-compare-neg-zero", "use-isnan", "valid-typeof", "no-unsafe-negation", "no-sparse-arrays", "no-self-assign"];
const rules = Object.fromEntries([...six, ...eleven].map(r => [r, "error"]));
const json = process.argv.includes("--json");
const tally = {};
function verify(c) {
	if (c.ext) {
		const tsx = c.ext === "tsx";
		return linter.verify(c.code, [{ files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: tsx } }, sourceType: "module" }, rules }], { filename: tsx ? "a.tsx" : "a.ts" });
	}
	let messages;
	for (const [t, j] of [["script", !!c.jsx], ["module", !!c.jsx], ["script", true], ["module", true]]) {
		messages = linter.verify(c.code, [{ languageOptions: { ecmaVersion: "latest", sourceType: t, parserOptions: { ecmaFeatures: { jsx: j } } }, rules }]);
		if (!messages.some(m => m.fatal)) break;
	}
	return messages;
}
for (const kind of ["edge", "ts"])
	for (const from of six) {
		const file = path.join(__dirname, "..", "cases", `td-${kind}-${from}.json`);
		if (!fs.existsSync(file)) continue;
		for (const raw of JSON.parse(fs.readFileSync(file, "utf8"))) {
			const c = typeof raw === "string" ? { code: raw } : raw;
			const messages = verify(c);
			if (messages.some(m => m.fatal)) continue;
			for (const rule of new Set(messages.map(m => m.ruleId))) {
				if (rule === from) continue;
				tally[`${rule} <- ${kind} ${from}`] = (tally[`${rule} <- ${kind} ${from}`] || 0) + 1;
				if (json) console.log(JSON.stringify({ rule, from, code: c.code, ...(c.jsx ? { jsx: true } : {}), ...(c.ext ? { ext: c.ext } : {}), expect: messages.filter(m => m.ruleId === rule).map(m => ({ line: m.line, column: m.column, message: m.message })) }));
			}
		}
	}
if (!json) for (const [k, n] of Object.entries(tally).sort()) console.log(k, n);
