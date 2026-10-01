// Runs the model beside ESLint's own no-unused-vars and prints every case where the two differ.
// usage: node check-model.cjs [--files] <cases.json | file.js>...   (cases.json: an array of strings or { code, ext?, jsx? }, or carried.json of carry)
"use strict";
const fs = require("fs");
const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const model = require("./core-model.cjs");
const linter = new Linter({ configType: "flat" });
const args = process.argv.slice(2);
const asFiles = args[0] === "--files" && args.shift();
const run = (code, ext) => {
	const sourceType = /c[jt]s$/.test(ext) ? "commonjs" : "module";
	const config = [{
		files: ["**/*.{js,jsx,mjs,cjs}"],
		plugins: { model: { rules: { "no-unused-vars": model } } },
		languageOptions: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: ext === "jsx" } } },
		linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
		rules: { "no-unused-vars": "error", "model/no-unused-vars": "error" },
	}];
	return linter.verify(code, config, { filename: `c.${ext}` });
};
let total = 0, same = 0, fatal = 0, differ = 0, reports = 0;
const one = (code, ext, label) => {
	total++;
	let messages;
	try { messages = run(code, ext); } catch (e) { console.log(`THROWN ${label}: ${e.message.split("\n")[0]}`); differ++; return; }
	if (messages.some(m => m.fatal)) { fatal++; return; }
	const of = id => messages.filter(m => m.ruleId === id).map(m => `${m.line}:${m.column} ${m.message}`).sort();
	const real = of("no-unused-vars"), mine = of("model/no-unused-vars");
	reports += real.length;
	if (JSON.stringify(real) === JSON.stringify(mine)) { same++; return; }
	differ++;
	console.log(`DIFFER ${label}\n   eslint: ${JSON.stringify(real.filter(x => !mine.includes(x)))}\n   model:  ${JSON.stringify(mine.filter(x => !real.includes(x)))}`);
};
for (const arg of args) {
	if (asFiles || !arg.endsWith(".json")) {
		const ext = path.extname(arg).slice(1);
		if (!["js", "jsx", "mjs", "cjs"].includes(ext)) continue;
		one(fs.readFileSync(arg, "utf8"), ext, arg);
		if (ext === "js") continue;
	} else {
		const parsed = JSON.parse(fs.readFileSync(arg, "utf8"));
		for (const raw of Array.isArray(parsed) ? parsed : parsed.cases) {
			const c = typeof raw === "string" ? { code: raw } : raw;
			const ext = c.ext || (c.jsx ? "jsx" : "js");
			if (/ts/.test(ext)) continue;
			one(c.code, ext, JSON.stringify(c.code).slice(0, 160));
		}
	}
}
console.log({ total, same, fatal, differ, reportsOfEslint: reports });
