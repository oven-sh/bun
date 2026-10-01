// Which cases of the fixtures in the tree make one of the five regex rules report, by ESLint at the pin.
// The test of a rule takes a line of another rule only when the fixture of that rule has the case: these are the cases to add.
// usage: node cross.cjs [--json] [--all] [--dir=<fixtures>]   --json: one line per case and rule, { rule, from, code, jsx?, expect: [{ line, column, message }] }
"use strict";
const path = require("path");
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
const mine = ["no-control-regex", "no-regex-spaces", "no-useless-backreference", "no-misleading-character-class", "no-useless-escape"];
const dir = process.argv.find(a => a.startsWith("--dir="))?.slice(6) ?? "/workspace/wt/cli/test/cli/lint/rules";
// --all: every rule that has a fixture in the directory, which is what rules.test.ts needs once the fixtures of the seven exist.
const names = process.argv.includes("--all") ? fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)) : mine;
const rules = Object.fromEntries(names.map(r => [r, "error"]));
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
