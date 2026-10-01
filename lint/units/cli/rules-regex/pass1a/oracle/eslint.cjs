// Research scratch: ESLint at the pin, one rule at its default options, over a list of cases.
// usage: node eslint.cjs <rule> <cases.json> [--all-recommended] [--ts]
// A case is a string or { code, languageOptions?, parser?, jsx?, ts? }. One JSON line per case:
// { kind?, code, type (script|module|ts|tsx), jsx?, fatal?, reports: ["line:column-endLine:endColumn message"] }.
// A case without a sourceType runs as a script, then as a module, then each with JSX: the first that parses counts.
// A case with `parser` or `ts`, and every case under --ts, runs with @typescript-eslint/parser as a.ts (a.tsx with `jsx`).
"use strict";
const path = require("path");
const fs = require("fs");
const eslintDir = "/workspace/ref/eslint";
const { Linter } = require(path.join(eslintDir, "lib/linter"));
const rec = require(path.join(eslintDir, "packages/js/src/configs/eslint-recommended.js"));
const tsParser = require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const rule = process.argv[2];
const allRec = process.argv.includes("--all-recommended");
const forceTs = process.argv.includes("--ts");
const file = process.argv.find(a => a.endsWith(".json"));
const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
const rules = allRec ? rec.rules : { [rule]: "error" };
function run(code, sourceType, jsx) {
	return linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } }, rules }]);
}
function runTs(code, jsx) {
	const name = jsx ? "a.tsx" : "a.ts";
	return linter.verify(
		code,
		[{ files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx } } }, rules }],
		{ filename: name },
	);
}
const show = m => (allRec ? `${m.ruleId} ${m.line}:${m.column} ${m.message}` : `${m.line}:${m.column}-${m.endLine}:${m.endColumn} ${m.message}`);
for (const raw of parsed) {
	const c = typeof raw === "string" ? { code: raw } : raw;
	const o = c.languageOptions || {};
	let jsx = !!(c.jsx || (o.parserOptions && o.parserOptions.ecmaFeatures && o.parserOptions.ecmaFeatures.jsx));
	let type;
	let messages;
	if (forceTs || c.parser || c.ts) {
		type = jsx ? "tsx" : "ts";
		messages = runTs(c.code, jsx);
	} else {
		type = o.sourceType || "script";
		messages = run(c.code, type, jsx);
		if (!o.sourceType && messages.some(m => m.fatal)) {
			for (const [t, j] of [["module", jsx], ["script", true], ["module", true]]) {
				const other = run(c.code, t, j);
				if (!other.some(m => m.fatal)) {
					messages = other;
					type = t;
					jsx = j;
					break;
				}
			}
		}
	}
	const fatal = messages.find(m => m.fatal);
	console.log(
		JSON.stringify({
			kind: c.kind,
			code: c.code,
			type,
			jsx: jsx || undefined,
			options: c.options,
			fatal: fatal ? `${fatal.line}:${fatal.column} ${fatal.message}` : undefined,
			reports: messages.filter(m => !m.fatal).map(show),
		}),
	);
}
