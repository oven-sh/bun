// Runs ESLint (pinned lib) rules no-duplicate-case and no-self-assign over a list of snippets.
// usage: node oracle.cjs <rule> <cases.json>   (cases.json: array of strings or {code, sourceType, jsx})
"use strict";
const path = require("path");
const { Linter } = require(path.join(__dirname, "eslint-pin/lib/linter"));
const fs = require("fs");

const rule = process.argv[2];
const cases = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const linter = new Linter({ configType: "flat" });
const out = [];
for (const c of cases) {
	const code = typeof c === "string" ? c : c.code;
	const sourceType = (typeof c === "object" && c.sourceType) || "script";
	const jsx = typeof c === "object" && !!c.jsx;
	const messages = linter.verify(code, [
		{
			languageOptions: {
				ecmaVersion: "latest",
				sourceType,
				parserOptions: { ecmaFeatures: { jsx } },
			},
			rules: { [rule]: "error" },
		},
	]);
	out.push({
		code,
		messages: messages.map(m => ({
			ruleId: m.ruleId,
			line: m.line,
			column: m.column,
			endLine: m.endLine,
			endColumn: m.endColumn,
			message: m.message,
			fatal: m.fatal || undefined,
		})),
	});
}
for (const o of out) {
	console.log(JSON.stringify(o.code));
	if (o.messages.length === 0) console.log("    (none)");
	for (const m of o.messages) {
		console.log(
			`    ${m.fatal ? "FATAL " : ""}${m.line}:${m.column}-${m.endLine}:${m.endColumn} [${m.ruleId}] ${m.message}`,
		);
	}
}
