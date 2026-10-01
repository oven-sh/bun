// Which cases of the fixtures in the tree make one of the five rules on code paths report, by ESLint at the pin.
// The test of a rule takes a line of another rule only when the fixture of that rule has the case: these are the cases to add.
// usage: node cross.cjs [--rules=a,b] [--json]   --json: one line per case and rule, { rule, from, code, jsx?, expect: [{ line, column, message }] }
"use strict";
const path = require("path");
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
const mine = (process.argv.find(a => a.startsWith("--rules=")) || "--rules=no-unreachable,getter-return,no-fallthrough,constructor-super,no-this-before-super").slice(8).split(",");
const rules = Object.fromEntries(mine.map(r => [r, "error"]));
const dir = "/workspace/wt/cli/test/cli/lint/rules";
const json = process.argv.includes("--json");
const tally = {};
let total = 0;
let fatal = 0;
for (const f of fs.readdirSync(dir).sort()) {
	const from = f.replace(".json", "");
	for (const c of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) {
		total++;
		let messages;
		// The first of script, module, script with JSX, module with JSX that ESLint's parser takes.
		for (const [t, jsx] of [["script", !!c.jsx], ["module", !!c.jsx], ["script", true], ["module", true]]) {
			messages = linter.verify(c.code, [{ languageOptions: { ecmaVersion: "latest", sourceType: t, parserOptions: { ecmaFeatures: { jsx } } }, rules }]);
			if (!messages.some(m => m.fatal)) break;
		}
		if (messages.some(m => m.fatal)) {
			fatal++;
			continue;
		}
		for (const rule of new Set(messages.map(m => m.ruleId))) {
			if (rule === from) continue;
			tally[`${rule} <- ${from}`] = (tally[`${rule} <- ${from}`] || 0) + 1;
			if (json) {
				const expect = messages.filter(m => m.ruleId === rule).map(m => ({ line: m.line, column: m.column, message: m.message }));
				console.log(JSON.stringify({ rule, from, code: c.code, ...(c.jsx ? { jsx: true } : {}), expect }));
			}
		}
	}
}
if (!json) {
	console.log("cases", total, "that ESLint's parser rejects", fatal);
	for (const [k, n] of Object.entries(tally).sort()) console.log(k, n);
}
