// Runs the TypeScript model beside @typescript-eslint/no-unused-vars and prints every case where the two differ.
// usage: node check-ts-model.cjs [--files] <cases.json | file.ts>...   (a case without a TypeScript extension is skipped)
"use strict";
const fs = require("fs");
const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const fromTs = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = fromTs("@typescript-eslint/parser");
const tsPlugin = fromTs("@typescript-eslint/eslint-plugin");
const model = require("./ts-model.cjs");
const linter = new Linter({ configType: "flat" });
const args = process.argv.slice(2);
const asFiles = args[0] === "--files" && args.shift();
const EXTS = ["d.ts", "d.mts", "d.cts", "ts", "tsx", "mts", "cts"];
const extOf = file => EXTS.find(e => file.endsWith("." + e));
const run = (code, ext) => {
	const sourceType = /c[jt]s$/.test(ext) ? "commonjs" : "module";
	const config = [{
		files: ["**/*.{ts,tsx,mts,cts}"],
		plugins: { "@typescript-eslint": tsPlugin, model: { rules: { "no-unused-vars": model } } },
		languageOptions: { ecmaVersion: "latest", sourceType, parser: tsParser, parserOptions: { ecmaFeatures: { jsx: ext === "tsx" } } },
		linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
		rules: { "@typescript-eslint/no-unused-vars": "error", "model/no-unused-vars": "error" },
	}];
	return linter.verify(code, config, { filename: `c.${ext}` });
};
let total = 0, same = 0, fatal = 0, differ = 0, reports = 0, extra = 0, missing = 0, moved = 0;
const view = !!process.env.BUN_VIEW;
const one = (code, ext, label) => {
	total++;
	let messages;
	try { messages = run(code, ext); } catch (e) { console.log(`THROWN ${label}: ${e.message.split("\n")[0]}`); differ++; return; }
	if (messages.some(m => m.fatal)) { fatal++; return; }
	const of = id => messages.filter(m => m.ruleId === id).map(m => `${m.line}:${m.column} ${m.message}`).sort();
	const real = of("@typescript-eslint/no-unused-vars"), mine = of("model/no-unused-vars");
	reports += real.length;
	if (JSON.stringify(real) === JSON.stringify(mine)) { same++; return; }
	differ++;
	if (view) {
		// With BUN_VIEW the model may say less than typescript-eslint, never more: only a line that typescript-eslint has not is printed.
		const names = list => list.map(x => x.replace(/^\d+:\d+ /, "").replace(/ but .*$/, ""));
		const more = mine.filter(x => !real.includes(x)), less = real.filter(x => !mine.includes(x));
		const moreNames = names(more), lessNames = names(less);
		const trulyMore = more.filter((x, i) => !lessNames.includes(moreNames[i]));
		missing += less.length - (more.length - trulyMore.length); moved += more.length - trulyMore.length; extra += trulyMore.length;
		if (trulyMore.length) console.log(`EXTRA ${label}\n   model only: ${JSON.stringify(trulyMore)}`);
		if (process.env.SHOW_MISSING) for (const x of less) if (!more.length) console.log(`MISSING ${label} ${x}`);
		if (process.env.SHOW_MOVED && more.length - trulyMore.length) console.log(`MOVED ${label}\n   tseslint: ${JSON.stringify(less)}\n   model:    ${JSON.stringify(more)}`);
		return;
	}
	console.log(`DIFFER ${label}\n   tseslint: ${JSON.stringify(real.filter(x => !mine.includes(x)))}\n   model:    ${JSON.stringify(mine.filter(x => !real.includes(x)))}`);
};
for (const arg of args) {
	if (asFiles || !arg.endsWith(".json")) {
		const ext = extOf(arg);
		if (!ext) continue;
		one(fs.readFileSync(arg, "utf8"), ext, arg);
	} else {
		const parsed = JSON.parse(fs.readFileSync(arg, "utf8"));
		for (const raw of Array.isArray(parsed) ? parsed : parsed.cases) {
			const c = typeof raw === "string" ? { code: raw } : raw;
			const ext = c.ext || (c.jsx ? "jsx" : "js");
			if (!/ts/.test(ext)) continue;
			one(c.code, ext, `[${ext}] ` + JSON.stringify(c.code).slice(0, 160));
		}
	}
}
console.log(view ? { total, same, fatal, differ, reportsOfTseslint: reports, extra, missing, movedOrOtherText: moved } : { total, same, fatal, differ, reportsOfTseslint: reports });
