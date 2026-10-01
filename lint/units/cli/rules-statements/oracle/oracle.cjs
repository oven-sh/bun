// Research scratch: ESLint at the pin over ESLint's own cases of one rule.
// usage: node oracle.cjs <rule> [--all-recommended] [--ts]   reads <rule>.cases.json (extract.cjs), prints one JSON line per case.
"use strict";
const path = require("path");
const fs = require("fs");
const eslintDir = "/workspace/ref/eslint";
const { Linter } = require(path.join(eslintDir, "lib/linter"));
const rec = require(path.join(eslintDir, "packages/js/src/configs/eslint-recommended.js"));
const linter = new Linter({ configType: "flat" });
const rule = process.argv[2];
const allRec = process.argv.includes("--all-recommended");
const file = process.argv.find(a => a.endsWith(".json")) || require("path").join(__dirname, "..", "cases", `upstream-${rule}.json`);
const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
const flat = Array.isArray(parsed) ? parsed : [...parsed.valid.map(c => ({ ...c, kind: "valid" })), ...parsed.invalid.map(c => ({ ...c, kind: "invalid" }))];
function run(code, sourceType, jsx, rules) {
	return linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } }, rules }]);
}
const out = [];
for (const raw of flat) {
	const c = typeof raw === "string" ? { code: raw } : raw;
	const o = c.languageOptions || {};
	const skip = o.globals ? "globals" : typeof o.ecmaVersion === "number" && o.ecmaVersion < 6 ? "es5" : null;
	const rules = allRec ? rec.rules : { [rule]: "error" };
	let type = o.sourceType || "script";
	let jsx = !!(o.parserOptions && o.parserOptions.ecmaFeatures && o.parserOptions.ecmaFeatures.jsx);
	let messages = run(c.code, type, jsx, rules);
	if (!o.sourceType && messages.some(m => m.fatal)) {
		for (const [t, j] of [["module", jsx], ["script", true], ["module", true]]) {
			const other = run(c.code, t, j, rules);
			if (!other.some(m => m.fatal)) { messages = other; type = t; jsx = j; break; }
		}
	}
	const fatal = messages.find(m => m.fatal);
	out.push({
		kind: c.kind, code: c.code, type, jsx: jsx || undefined, skip: skip || undefined, given: c.languageOptions ? JSON.stringify(c.languageOptions) : undefined,
		fatal: fatal ? fatal.message : undefined,
		reports: messages.filter(m => !m.fatal).map(m => (allRec ? `${m.ruleId} ${m.line}:${m.column} ${m.message}` : `${m.line}:${m.column}-${m.endLine}:${m.endColumn} ${m.message}`)),
	});
}
for (const o of out) console.log(JSON.stringify(o));
