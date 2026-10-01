// Research probe: among the 23 rules (11 in the tree, 12 of this unit), which report on the cases of ESLint's tests and the edge lists of the 12.
"use strict";
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
const MINE = ["for-direction", "no-async-promise-executor", "no-case-declarations", "no-delete-var", "no-prototype-builtins", "no-setter-return", "no-unsafe-finally", "no-unused-labels", "no-useless-catch", "no-with", "require-yield", "no-unused-private-class-members"];
const ROUND1 = ["no-debugger", "no-dupe-keys", "no-dupe-class-members", "no-duplicate-case", "no-empty-pattern", "no-compare-neg-zero", "use-isnan", "valid-typeof", "no-unsafe-negation", "no-sparse-arrays", "no-self-assign"];
const rules = Object.fromEntries([...MINE, ...ROUND1].map(r => [r, "error"]));
function verify(code, jsx) {
	for (const [t, j] of [["script", jsx], ["module", jsx]]) {
		const messages = linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType: t, parserOptions: { ecmaFeatures: { jsx: j } } }, rules }]);
		if (!messages.some(m => m.fatal)) return messages;
	}
	return null;
}
const N = "/workspace/notes/lint/units/cli/rules-statements/cases";
for (const rule of MINE) {
	const lists = [`${N}/upstream-${rule}.json`, `${N}/edge-${rule}.json`, `${N}/edge2-${rule}.json`].filter(f => fs.existsSync(f));
	for (const f of lists) {
		const parsed = JSON.parse(fs.readFileSync(f, "utf8"));
		const flat = Array.isArray(parsed) ? parsed : [...parsed.valid, ...parsed.invalid];
		for (const raw of flat) {
			const c = typeof raw === "string" ? { code: raw } : raw;
			const o = c.languageOptions || {};
			if (o.globals || (typeof o.ecmaVersion === "number" && o.ecmaVersion < 6)) continue;
			const messages = verify(c.code, false);
			if (!messages) continue;
			for (const m of messages) if (m.ruleId !== rule) console.log(`${f.split("/").pop()}\t${m.ruleId}\t${m.line}:${m.column}\t${JSON.stringify(c.code).slice(0, 150)}`);
		}
	}
}
