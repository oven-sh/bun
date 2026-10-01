// Research scratch: on how many cases of the fixtures of the tree a rule that reads scopes reports (rules.test.ts takes a line
// of another rule only when the fixture of that rule has the case).  usage: node cross-count.cjs [rule,rule...]
"use strict";
const fs = require("fs"), path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const dir = "/workspace/wt/cli/test/cli/lint/rules";
const rules = (process.argv[2] || "no-undef,no-unused-vars,no-redeclare,no-const-assign,no-global-assign,no-shadow-restricted-names").split(",");
const globals = {};
for (const g of fs.readFileSync(path.join(__dirname, "bun-globals.txt"), "utf8").split("\n").filter(l => !l.startsWith("#")).join(" ").split(/\s+/).filter(Boolean)) globals[g.replace(/:w$/, "")] = g.endsWith(":w") ? "writable" : "readonly";
const linter = new Linter({ configType: "flat" });
const run = (code, sourceType, jsx) => linter.verify(code, [{ files: ["**/*.js", "**/*.jsx", "**/*.cjs"], languageOptions: { ecmaVersion: "latest", sourceType, globals, parserOptions: { ecmaFeatures: { jsx } } }, rules: Object.fromEntries(rules.map(r => [r, "error"])) }], { filename: sourceType === "commonjs" ? "a.cjs" : jsx ? "a.jsx" : "a.js" });
let total = 0, fatalBoth = 0, asCommonjs = 0;
const hit = Object.fromEntries(rules.map(r => [r, 0]));
for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
	const cases = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
	const per = Object.fromEntries(rules.map(r => [r, 0]));
	for (const c of cases) {
		total++;
		let messages = run(c.code, "module", true);
		if (messages.some(m => m.fatal)) { messages = run(c.code, "commonjs", true); if (messages.some(m => m.fatal)) { fatalBoth++; continue; } asCommonjs++; }
		for (const r of rules) if (messages.some(m => m.ruleId === r)) { per[r]++; hit[r]++; }
	}
	console.log(file.padEnd(30), String(cases.length).padStart(5), rules.map(r => `${r}=${per[r]}`).join(" "));
}
console.log({ total, fatalBoth, asCommonjs, hit });
