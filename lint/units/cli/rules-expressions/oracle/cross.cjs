// Research scratch. Which cases of which list make which other rule report, by ESLint at the pin.
// usage: node cross.cjs existing   the cases of test/cli/lint/rules/*.json of the worktree on which one of the six rules reports
//        node cross.cjs upstream   the cases of ../cases/td-upstream-<rule>.json on which another of the 17 rules reports (11 of the tree + the six)
//        add --json for one line per case and rule: { rule, from, code, jsx?, expect }
"use strict";
const path = require("path");
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
const six = ["no-cond-assign", "no-constant-binary-expression", "no-constant-condition", "no-dupe-else-if", "no-extra-boolean-cast", "no-unsafe-optional-chaining"];
const eleven = ["no-debugger", "no-dupe-keys", "no-dupe-class-members", "no-duplicate-case", "no-empty-pattern", "no-compare-neg-zero", "use-isnan", "valid-typeof", "no-unsafe-negation", "no-sparse-arrays", "no-self-assign"];
const mode = process.argv[2];
const json = process.argv.includes("--json");
const tally = {};
let total = 0, fatal = 0;
function verify(code, jsx, rules) {
	let messages;
	for (const [t, j] of [["script", !!jsx], ["module", !!jsx], ["script", true], ["module", true]]) {
		messages = linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType: t, parserOptions: { ecmaFeatures: { jsx: j } } }, rules }]);
		if (!messages.some(m => m.fatal)) return messages;
	}
	return null;
}
function each(from, cases, rules) {
	for (const c of cases) {
		total++;
		const messages = verify(c.code, c.jsx, rules);
		if (!messages) { fatal++; continue; }
		for (const rule of new Set(messages.map(m => m.ruleId))) {
			if (rule === from) continue;
			tally[`${rule} <- ${from}`] = (tally[`${rule} <- ${from}`] || 0) + 1;
			if (json) console.log(JSON.stringify({ rule, from, code: c.code, ...(c.jsx ? { jsx: true } : {}), expect: messages.filter(m => m.ruleId === rule).map(m => ({ line: m.line, column: m.column, message: m.message })) }));
		}
	}
}
if (mode === "existing") {
	const dir = "/workspace/wt/cli/test/cli/lint/rules";
	const rules = Object.fromEntries(six.map(r => [r, "error"]));
	for (const f of fs.readdirSync(dir).sort()) each(f.replace(".json", ""), JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")), rules);
} else {
	const rules = Object.fromEntries([...six, ...eleven].map(r => [r, "error"]));
	for (const r of six) {
		const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "cases", `td-upstream-${r}.json`), "utf8"));
		const cases = [...d.valid, ...d.invalid].filter(c => !(c.languageOptions && c.languageOptions.globals)).map(c => ({ code: c.code, jsx: !!(c.languageOptions && c.languageOptions.parserOptions && c.languageOptions.parserOptions.ecmaFeatures && c.languageOptions.parserOptions.ecmaFeatures.jsx) }));
		each(r, cases, rules);
	}
}
if (!json) {
	console.log("cases", total, "that ESLint's parser rejects", fatal);
	for (const [k, n] of Object.entries(tally).sort()) console.log(k, n);
}
