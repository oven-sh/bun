// Research scratch. ESLint at the pin over snippets: node run.cjs <rule[,rule]> [--module] <code>...   (or a JSON array file of codes)
"use strict";
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
const args = process.argv.slice(2);
const rule = args.shift();
let type = "script";
if (args[0] === "--module") { type = "module"; args.shift(); }
let codes = args;
if (codes.length === 1 && codes[0].endsWith(".json")) codes = JSON.parse(require("fs").readFileSync(codes[0], "utf8")).map(c => (typeof c === "string" ? c : c.code));
for (const code of codes) {
	let messages;
	for (const [t, jsx] of [[type, false], ["module", false], ["script", true], ["module", true]]) {
		messages = linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType: t, parserOptions: { ecmaFeatures: { jsx } } }, rules: Object.fromEntries(rule.split(",").map(r => [r, "error"])) }]);
		if (!messages.some(m => m.fatal)) break;
	}
	console.log(JSON.stringify(code) + "\n      => " + (messages.map(m => (m.fatal ? "FATAL " : "") + `${m.ruleId || ""} ${m.line}:${m.column} ${m.message}`).join(" | ") || "(none)"));
}
