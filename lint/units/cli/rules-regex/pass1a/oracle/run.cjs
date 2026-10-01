// Research scratch: ESLint at the pin over codes given in a JSON list, several rules at once, at their default options.
// usage: node run.cjs <rule[,rule]> <cases.json> [--ts]
// A case: a string or { code, ext?: "js"|"jsx"|"ts"|"tsx", sourceType? }. ts and tsx run with @typescript-eslint/parser.
// One line per case: the code, then "rule line:column-endLine:endColumn message" per report, or FATAL.
"use strict";
const path = require("path");
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const tsParser = require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const rules = Object.fromEntries(process.argv[2].split(",").map(r => [r, "error"]));
const forceTs = process.argv.includes("--ts");
const json = process.argv.includes("--json");
const list = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const esc = s => JSON.stringify(s).replace(/[\u0080-\uffff]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
for (const raw of list) {
	const c = typeof raw === "string" ? { code: raw } : raw;
	const ext = c.ext || (forceTs ? "ts" : c.jsx ? "jsx" : "js");
	let messages;
	if (ext === "ts" || ext === "tsx") {
		messages = linter.verify(c.code, [{ files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: ext === "tsx" } } }, rules }], { filename: "a." + ext });
	} else {
		const types = c.sourceType ? [c.sourceType] : ["script", "module"];
		for (const sourceType of types) {
			messages = linter.verify(c.code, [{ languageOptions: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: ext === "jsx" } } }, rules }]);
			if (!messages.some(m => m.fatal)) break;
		}
	}
	const fatal = messages.find(m => m.fatal);
	const reports = messages.filter(m => !m.fatal).map(m => `${m.ruleId} ${m.line}:${m.column}-${m.endLine}:${m.endColumn} ${m.message}`);
	if (json) console.log(JSON.stringify({ code: c.code, ext, fatal: fatal ? `${fatal.line}:${fatal.column} ${fatal.message}` : undefined, reports }));
	else console.log(`${ext.padEnd(3)} ${esc(c.code)}\n      => ${fatal ? "FATAL " + fatal.message : ""}${reports.map(r => esc(r).slice(1, -1)).join(" | ")}`);
}
