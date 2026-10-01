// Research scratch of "rules-bindings": which cases of the fixtures of OTHER rules make one of the ten binding rules report
// (ESLint at the pin, the globals of Bun). rules.test.ts takes a line of another rule only when the fixture of that rule
// has the case, so each such case has to be added to the fixture of the rule that reports.
// usage: node cross-add.cjs [--dir <fixtures dir>] [--json]     default dir: test/cli/lint/rules of the worktree
// A case: { code, jsx?, ext? }. ext ts/tsx/mts/cts: typescript-eslint's parser and @typescript-eslint/no-redeclare; cjs/cts: commonjs.
"use strict";
const fs = require("fs"), path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const TEN = ["no-class-assign", "no-ex-assign", "no-func-assign", "no-import-assign", "no-global-assign", "no-dupe-args", "no-redeclare", "no-shadow-restricted-names", "no-obj-calls", "no-new-native-nonconstructor"];
const args = process.argv.slice(2);
const dir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : "/workspace/wt/cli/test/cli/lint/rules";
const json = args.includes("--json");
const globals = {};
for (const g of fs.readFileSync("/workspace/notes/lint/units/cli/name-resolution/oracle/bun-globals.txt", "utf8").split("\n").filter(l => !l.startsWith("#")).join(" ").split(/\s+/).filter(Boolean)) globals[g.replace(/:w$/, "")] = g.endsWith(":w") ? "writable" : "readonly";
const req = require("module").createRequire("/workspace/ref/tseslint/package.json");
const parser = req("@typescript-eslint/parser"), plugin = req("@typescript-eslint/eslint-plugin");
const linter = new Linter({ configType: "flat" });
function run(c) {
	const ext = c.ext || (c.jsx ? "jsx" : "js");
	const ts = /^(ts|tsx|mts|cts)$/.test(ext);
	const sourceType = ext === "cjs" ? "commonjs" : "module";
	const rules = Object.fromEntries(TEN.map(r => [ts && r === "no-redeclare" ? "@typescript-eslint/no-redeclare" : r, "error"]));
	const config = { files: ["**/*.js", "**/*.jsx", "**/*.cjs", "**/*.mjs", "**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"], plugins: ts ? { "@typescript-eslint": plugin } : {}, languageOptions: { ecmaVersion: "latest", sourceType, globals, ...(ts ? { parser } : {}), parserOptions: { ecmaFeatures: { jsx: ext === "jsx" || ext === "tsx" || ext === "js" } } }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules };
	return linter.verify(c.code, [config], { filename: `a.${ext}` });
}
const hit = Object.fromEntries(TEN.map(r => [r, 0]));
const out = [];
let total = 0, fatal = 0;
for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
	const own = file.slice(0, -5);
	const per = {};
	for (const c of JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))) {
		total++;
		const messages = run(c);
		if (messages.some(m => m.fatal)) { fatal++; continue; }
		for (const r of TEN) {
			if (r === own) continue;
			const ms = messages.filter(m => m.ruleId && m.ruleId.replace("@typescript-eslint/", "") === r);
			if (!ms.length) continue;
			hit[r]++; per[r] = (per[r] || 0) + 1;
			out.push({ rule: r, from: own, code: c.code, ...(c.jsx ? { jsx: true } : {}), ...(c.ext ? { ext: c.ext } : {}), eslint: ms.map(m => ({ line: m.line, column: m.column, message: m.message })) });
		}
	}
	if (!json && Object.keys(per).length) console.log(file.padEnd(32), Object.entries(per).map(([r, n]) => `${r}=${n}`).join(" "));
}
if (json) console.log(JSON.stringify(out));
else console.log({ total, fatal, hit });
