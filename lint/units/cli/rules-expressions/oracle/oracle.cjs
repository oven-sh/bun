// Research scratch: ESLint at the pin, its own parser, default options, over a list of cases of one rule.
// usage: node oracle.cjs <rule> [cases.json] [--all-recommended]
//   cases.json: { base?, valid, invalid } of extract.cjs, or a JSON array of codes or of { code, jsx?, languageOptions? }.
//   Default: ../cases/upstream-<rule>.json. Prints one JSON line per case:
//   { kind?, code, type, jsx?, skip?, fatal?, reports: ["line:column-endLine:endColumn message"] }
//   With --all-recommended the reports are "rule line:column message" of every rule of eslint:recommended.
// A case is run with the sourceType it names (its own, else the one of the file's RuleTester), else as a script and, when
// that does not parse, as a module; then the same with JSX. skip: the case sets globals or an edition before 2015.
"use strict";
const path = require("path");
const fs = require("fs");
const eslintDir = "/workspace/ref/eslint";
const { Linter } = require(path.join(eslintDir, "lib/linter"));
const rec = require(path.join(eslintDir, "packages/js/src/configs/eslint-recommended.js"));
const linter = new Linter({ configType: "flat" });
const rule = process.argv[2];
const allRec = process.argv.includes("--all-recommended");
const file = process.argv.slice(3).find(a => a.endsWith(".json")) || path.join(__dirname, "..", "cases", `upstream-${rule}.json`);
const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
const base = (!Array.isArray(parsed) && parsed.base) || {};
const flat = Array.isArray(parsed) ? parsed : [...parsed.valid.map(c => ({ ...c, kind: "valid" })), ...parsed.invalid.map(c => ({ ...c, kind: "invalid" }))];
function run(code, sourceType, jsx, rules) {
	return linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } }, rules }]);
}
for (const raw of flat) {
	const c = typeof raw === "string" ? { code: raw } : raw;
	const o = c.languageOptions || {};
	const skip = o.globals ? "globals" : typeof o.ecmaVersion === "number" && o.ecmaVersion < 6 ? "es5" : null;
	const rules = allRec ? rec.rules : { [rule]: "error" };
	const named = o.sourceType || base.sourceType;
	const jsxNamed = !!(c.jsx || (o.parserOptions && o.parserOptions.ecmaFeatures && o.parserOptions.ecmaFeatures.jsx));
	const tries = named ? [[named, jsxNamed], [named, true]] : [["script", jsxNamed], ["module", jsxNamed], ["script", true], ["module", true]];
	let messages, type, jsx;
	for (const [t, j] of tries) {
		const got = run(c.code, t, j, rules);
		if (!messages || !got.some(m => m.fatal)) {
			messages = got;
			type = t;
			jsx = j;
		}
		if (!got.some(m => m.fatal)) break;
	}
	const fatal = messages.find(m => m.fatal);
	console.log(
		JSON.stringify({
			kind: c.kind,
			code: c.code,
			type,
			jsx: jsx || undefined,
			skip: skip || undefined,
			fatal: fatal ? fatal.message : undefined,
			reports: messages.filter(m => !m.fatal).map(m => (allRec ? `${m.ruleId} ${m.line}:${m.column} ${m.message}` : `${m.line}:${m.column}-${m.endLine}:${m.endColumn} ${m.message}`)),
		}),
	);
}
