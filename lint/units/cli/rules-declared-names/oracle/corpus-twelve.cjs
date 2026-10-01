// Research scratch: what no-undef (and the other eleven rules) of ESLint at the pin report over real files with the proposed table of globals.
// usage: node corpus-undef.cjs <list of paths relative to /workspace/wt/cli> <js|ts> [max]
"use strict";
const fs = require("fs"), path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const ROOT = "/workspace/wt/cli";
const kind = process.argv[3] || "js";
const max = Number(process.argv[4] || 1e9);
const TWELVE = ["no-class-assign", "no-const-assign", "no-ex-assign", "no-func-assign", "no-import-assign", "no-redeclare", "no-shadow-restricted-names", "no-dupe-args", "no-global-assign", "no-undef", "no-obj-calls", "no-new-native-nonconstructor"];
const globals = {};
for (const g of fs.readFileSync("/workspace/notes/lint/units/cli/name-resolution/oracle/bun-globals.txt", "utf8").split("\n").filter(l => !l.startsWith("#")).join(" ").split(/\s+/).filter(Boolean)) globals[g.replace(/:w$/, "")] = g.endsWith(":w") ? "writable" : "readonly";
if (process.env.JEST) for (const g of ["test", "it", "describe", "expect", "expectTypeOf", "beforeAll", "beforeEach", "afterEach", "afterAll", "jest", "vi", "xit", "xtest", "xdescribe"]) globals[g] = "readonly";
const req = require("module").createRequire("/workspace/ref/tseslint/package.json");
const parser = kind === "ts" ? req("@typescript-eslint/parser") : undefined;
const plugin = kind === "ts" ? req("@typescript-eslint/eslint-plugin") : undefined;
const linter = new Linter({ configType: "flat" });
const files = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).filter(f => (kind === "ts" ? /\.[cm]?tsx?$/.test(f) : /\.[cm]?jsx?$/.test(f))).slice(0, max);
const perRule = {}, names = {}, filesWith = {}; let fatal = 0, done = 0, filesAny = 0;
for (const f of files) {
	let code; try { code = fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { continue; }
	if (code.length > 400000) continue;
	const ext = path.extname(f).slice(1);
	const sourceType = /^c[jt]s$/.test(ext) ? "commonjs" : "module";
	const rules = {}; for (const r of TWELVE) rules[kind === "ts" && r === "no-redeclare" ? "@typescript-eslint/no-redeclare" : r] = "error";
	let messages;
	try {
		messages = linter.verify(code, [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], plugins: plugin ? { "@typescript-eslint": plugin } : {}, languageOptions: { ecmaVersion: "latest", sourceType, globals, ...(parser ? { parser } : {}), parserOptions: { ecmaFeatures: { jsx: kind !== "ts" || ext === "tsx" } } }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules }], { filename: "a." + ext });
	} catch (e) { fatal++; continue; }
	done++;
	if (messages.some(m => m.fatal)) { fatal++; continue; }
	const seen = new Set();
	for (const m of messages) {
		const r = (m.ruleId || "").replace("@typescript-eslint/", "");
		perRule[r] = (perRule[r] || 0) + 1;
		if (!seen.has(r)) { seen.add(r); filesWith[r] = (filesWith[r] || 0) + 1; }
		if (r === "no-undef") { const n = /^'(.*)' is not defined/.exec(m.message)[1]; names[n] = (names[n] || 0) + 1; }
	}
	if (seen.size) filesAny++;
}
console.log(JSON.stringify({ kind, files: files.length, linted: done, fatal, filesAny, perRule, filesWith }, null, 1));
console.log("top undefined names:", Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 80).map(([n, c]) => `${n}:${c}`).join(" "));
