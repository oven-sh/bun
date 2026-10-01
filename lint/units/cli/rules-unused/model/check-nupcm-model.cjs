// Runs nupcm-model.cjs beside ESLint's own no-unused-private-class-members and prints every case where the two differ.
// usage: node check-nupcm-model.cjs [--files list.txt] <cases.json | file>...   (cases: strings or { code, ext? }, or { valid, invalid })
"use strict";
const fs = require("fs");
const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const model = require("./nupcm-model.cjs");
const linter = new Linter({ configType: "flat" });
const isTs = ext => /^[cm]?tsx?$/.test(ext);
const run = (code, ext, sourceType) => {
	const jsx = ext === "jsx" || ext === "tsx";
	const languageOptions = isTs(ext) ? { parser: tsParser, ecmaVersion: "latest", sourceType } : { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } };
	const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], plugins: { model: { rules: { nupcm: model } } }, languageOptions, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { "no-unused-private-class-members": "error", "model/nupcm": "error" } }];
	return linter.verify(code, config, { filename: `c.${ext}` });
};
let total = 0, same = 0, fatal = 0, differ = 0, reports = 0;
const one = (code, ext, label) => {
	total++;
	let messages;
	try {
		messages = run(code, ext, /c[jt]s$/.test(ext) ? "commonjs" : "module");
		if (messages.some(m => m.fatal) && ext === "js") messages = run(code, ext, "commonjs");
	} catch (e) { console.log(`THROWN ${label}: ${e.message.split("\n")[0]}`); differ++; return; }
	if (messages.some(m => m.fatal)) { fatal++; return; }
	const of = id => messages.filter(m => m.ruleId === id).map(m => `${m.line}:${m.column} ${m.message}`).sort();
	const real = of("no-unused-private-class-members"), mine = of("model/nupcm");
	reports += real.length;
	if (JSON.stringify(real) === JSON.stringify(mine)) { same++; return; }
	differ++;
	console.log(`DIFFER ${label}\n   eslint: ${JSON.stringify(real.filter(x => !mine.includes(x)))}\n   model:  ${JSON.stringify(mine.filter(x => !real.includes(x)))}`);
};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
	const arg = args[i];
	if (arg === "--files") { for (const f of fs.readFileSync(args[++i], "utf8").split("\n").filter(Boolean)) { const ext = /\.d\.ts$/.test(f) ? "ts" : path.extname(f).slice(1); let code; try { code = fs.readFileSync(f, "utf8"); } catch { continue; } one(code, ext, f); } continue; }
	if (!arg.endsWith(".json")) { one(fs.readFileSync(arg, "utf8"), path.extname(arg).slice(1), arg); continue; }
	const parsed = JSON.parse(fs.readFileSync(arg, "utf8"));
	for (const raw of Array.isArray(parsed) ? parsed : [...parsed.valid, ...parsed.invalid]) {
		const c = typeof raw === "string" ? { code: raw } : raw;
		one(c.code, c.ext || (arg.includes("tseslint") ? "ts" : "js"), JSON.stringify(c.code).slice(0, 200));
	}
}
console.log(JSON.stringify({ total, same, fatal, differ, reportsOfEslint: reports }));
