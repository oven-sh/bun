// Research scratch of "rules-declared-names" (top-down): the twelve rules of ESLint at the pin over files of the repository,
// configured as a lint run of Bun would be: the table of Bun (and the 14 names of `bun test`) as the globals, .cjs/.cts commonjs,
// every other extension a module, a TypeScript extension through @typescript-eslint/parser with @typescript-eslint/no-redeclare.
// usage: node repo-rules.cjs <list-of-files.txt> [--max n] [--show rule] [--core-redeclare]
"use strict";
const fs = require("fs");
const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser"), tsPlugin = req("@typescript-eslint/eslint-plugin");
const args = process.argv.slice(2);
const max = args.includes("--max") ? +args[args.indexOf("--max") + 1] : Infinity;
const show = args.includes("--show") ? args[args.indexOf("--show") + 1] : null;
const coreRedeclare = args.includes("--core-redeclare");
const files = fs.readFileSync(args[0], "utf8").split("\n").filter(Boolean).slice(0, max);
const RULES = ["no-class-assign", "no-const-assign", "no-ex-assign", "no-func-assign", "no-import-assign", "no-redeclare", "no-shadow-restricted-names", "no-dupe-args", "no-global-assign", "no-undef", "no-obj-calls", "no-new-native-nonconstructor"];
const globals = {};
for (const g of fs.readFileSync("/workspace/notes/lint/units/cli/name-resolution/oracle/bun-globals.txt", "utf8").split("\n").filter(l => !l.startsWith("#")).join(" ").split(/\s+/).filter(Boolean)) globals[g.replace(/:w$/, "")] = g.endsWith(":w") ? "writable" : "readonly";
for (const g of ["test", "it", "describe", "expect", "expectTypeOf", "beforeAll", "beforeEach", "afterEach", "afterAll", "jest", "vi", "xit", "xtest", "xdescribe"]) globals[g] = "readonly";
const linter = new Linter({ configType: "flat" });
const per = Object.fromEntries(RULES.map(r => [r, { reports: 0, files: 0, samples: [] }]));
let n = 0, fatal = 0;
for (const file of files) {
	let code;
	try { code = fs.readFileSync(file, "utf8"); } catch { continue; }
	const ext = /\.d\.[cm]?ts$/.test(file) ? "d.ts" : path.extname(file).slice(1);
	const ts = /^(d\.ts|[cm]?tsx?)$/.test(ext);
	const sourceType = /^c[jt]s$/.test(ext) ? "commonjs" : "module";
	const named = r => (ts && r === "no-redeclare" && !coreRedeclare ? "@typescript-eslint/no-redeclare" : r);
	const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], plugins: { "@typescript-eslint": tsPlugin }, languageOptions: { ecmaVersion: "latest", sourceType, globals, ...(ts ? { parser: tsParser } : {}), parserOptions: { ecmaFeatures: { jsx: ext === "jsx" || ext === "tsx" } } }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: Object.fromEntries(RULES.map(r => [named(r), "error"])) }];
	let messages;
	try { messages = linter.verify(code, config, { filename: "c." + ext }); } catch (e) { fatal++; continue; }
	n++;
	if (messages.some(m => m.fatal)) { fatal++; continue; }
	const seen = new Set();
	for (const m of messages) {
		const rule = (m.ruleId || "").replace("@typescript-eslint/", "");
		if (!per[rule]) continue;
		per[rule].reports++;
		if (!seen.has(rule)) { seen.add(rule); per[rule].files++; }
		if (per[rule].samples.length < 400) per[rule].samples.push(`${path.relative("/workspace/wt/cli", file)}:${m.line}:${m.column} ${m.message} | ${code.split("\n")[m.line - 1].trim().slice(0, 110)}`);
	}
}
console.log(`files ${n}, rejected by the parser ${fatal}`);
for (const r of RULES) console.log(r.padEnd(30), `reports ${String(per[r].reports).padStart(5)} in ${per[r].files} files`);
if (show) for (const s of per[show].samples) console.log(s);
