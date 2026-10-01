// Research scratch of "rules-declared-names" (top-down): no-undef of ESLint at the pin over files of the repository, with the table
// of Bun as the configured globals.  usage: node repo-undef.cjs <list-of-files.txt> [--max n] [--test-globals]
// A TypeScript extension goes through @typescript-eslint/parser. Prints per-kind counts and the most frequent names.
"use strict";
const fs = require("fs");
const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const tsParser = require("module").createRequire("/workspace/ref/tseslint/")("@typescript-eslint/parser");
const args = process.argv.slice(2);
const max = args.includes("--max") ? +args[args.indexOf("--max") + 1] : Infinity;
const withTest = args.includes("--test-globals");
const files = fs.readFileSync(args[0], "utf8").split("\n").filter(Boolean).slice(0, max);
const globals = {};
for (const g of fs.readFileSync("/workspace/notes/lint/units/cli/name-resolution/oracle/bun-globals.txt", "utf8").split("\n").filter(l => !l.startsWith("#")).join(" ").split(/\s+/).filter(Boolean)) globals[g.replace(/:w$/, "")] = g.endsWith(":w") ? "writable" : "readonly";
if (withTest) for (const g of ["test", "it", "describe", "expect", "expectTypeOf", "beforeAll", "beforeEach", "afterEach", "afterAll", "jest", "vi", "xit", "xtest", "xdescribe"]) globals[g] = "readonly";
const linter = new Linter({ configType: "flat" });
// Whether the reported identifier stands in a type position: a rule beside no-undef that reports the type references.
const probe = { create(context) { return { "Program:exit"(node) { for (const ref of context.sourceCode.getScope(node).through) if (ref.isTypeReference && !ref.isValueReference) context.report({ node: ref.identifier, message: "T" }); } }; } };
const tally = { files: 0, fatal: 0, filesWithReports: 0, reports: 0, typeRefs: 0, valueRefs: 0 };
const names = new Map(), perExt = {};
for (const file of files) {
	let code;
	try { code = fs.readFileSync(file, "utf8"); } catch { continue; }
	const ext = /\.d\.[cm]?ts$/.test(file) ? "d.ts" : path.extname(file).slice(1);
	const ts = /^(d\.ts|[cm]?tsx?)$/.test(ext);
	const sourceType = /^c[jt]s$/.test(ext) ? "commonjs" : "module";
	const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], plugins: { p: { rules: { probe } } }, languageOptions: { ecmaVersion: "latest", sourceType, globals, ...(ts ? { parser: tsParser } : {}), parserOptions: { ecmaFeatures: { jsx: ext === "jsx" || ext === "tsx" } } }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { "no-undef": "error", "p/probe": "error" } }];
	let messages;
	try { messages = linter.verify(code, config, { filename: "c." + (ext === "d.ts" ? "d.ts" : ext) }); } catch (e) { tally.fatal++; continue; }
	tally.files++;
	const e = (perExt[ext] = perExt[ext] || { files: 0, fatal: 0, withReports: 0, reports: 0, type: 0 });
	e.files++;
	if (messages.some(m => m.fatal)) { tally.fatal++; e.fatal++; continue; }
	const typeAt = new Set(messages.filter(m => m.ruleId === "p/probe").map(m => `${m.line}:${m.column}`));
	const undef = messages.filter(m => m.ruleId === "no-undef");
	if (undef.length) { tally.filesWithReports++; e.withReports++; }
	for (const m of undef) {
		tally.reports++; e.reports++;
		const isType = typeAt.has(`${m.line}:${m.column}`);
		if (isType) { tally.typeRefs++; e.type++; } else tally.valueRefs++;
		const name = /'(.*)' is not defined/.exec(m.message)[1] + (isType ? " (type)" : "");
		const n = names.get(name) || { count: 0, files: new Set() };
		n.count++; n.files.add(file); names.set(name, n);
	}
}
console.log(JSON.stringify(tally));
console.log(JSON.stringify(perExt));
console.log([...names].sort((a, b) => b[1].files.size - a[1].files.size).slice(0, 60).map(([n, v]) => `${n}: ${v.count} in ${v.files.size} files`).join("\n"));
