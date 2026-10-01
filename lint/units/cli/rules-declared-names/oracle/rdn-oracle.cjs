// Research scratch of "rules-declared-names": what ESLint at the pin reports for the twelve rules of D4 that read declared names.
// usage: node rdn-oracle.cjs [--type module|commonjs|script] [--ts|--tsx] [--core] [--rules r1,r2] [--no-bun-globals] [--globals a,b:w] [--json] <code | file.json>...
// Default: the globals of Bun (../../name-resolution/oracle/bun-globals.txt) beside ESLint's es2026 list, no inline configuration.
// --ts / --tsx: @typescript-eslint/parser with its scope manager, and @typescript-eslint/no-redeclare in place of no-redeclare unless --core.
// A .json argument is an array of codes or of { code }, or { valid, invalid }. One line per case: `#i <code>` then each report, or FATAL.
"use strict";
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const TWELVE = ["no-class-assign", "no-const-assign", "no-ex-assign", "no-func-assign", "no-import-assign", "no-redeclare", "no-shadow-restricted-names", "no-dupe-args", "no-global-assign", "no-undef", "no-obj-calls", "no-new-native-nonconstructor"];
const args = process.argv.slice(2);
let type = "module", ts = false, tsx = false, rules = TWELVE, json = false, bunGlobals = true, core = false;
const globals = {};
const codes = [];
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a === "--type") type = args[++i];
	else if (a === "--ts") ts = true;
	else if (a === "--tsx") ts = tsx = true;
	else if (a === "--core") core = true;
	else if (a === "--rules") rules = args[++i].split(",");
	else if (a === "--json") json = true;
	else if (a === "--no-bun-globals") bunGlobals = false;
	else if (a === "--globals") for (const g of args[++i].split(",")) globals[g.replace(/:w$/, "")] = g.endsWith(":w") ? "writable" : "readonly";
	else if (a.endsWith(".json")) { const j = JSON.parse(fs.readFileSync(a, "utf8")); codes.push(...(Array.isArray(j) ? j : [...j.valid, ...j.invalid]).map(c => (typeof c === "string" ? c : c.code))); }
	else codes.push(a);
}
if (bunGlobals) for (const g of fs.readFileSync("/workspace/notes/lint/units/cli/name-resolution/oracle/bun-globals.txt", "utf8").split("\n").filter(l => !l.startsWith("#")).join(" ").split(/\s+/).filter(Boolean)) globals[g.replace(/:w$/, "")] = g.endsWith(":w") ? "writable" : "readonly";
const req = require("module").createRequire("/workspace/ref/tseslint/package.json");
const parser = ts ? req("@typescript-eslint/parser") : undefined;
const plugin = ts ? req("@typescript-eslint/eslint-plugin") : undefined;
const linter = new Linter({ configType: "flat" });
const out = [];
codes.forEach((code, index) => {
	const ruleConfig = {};
	for (const r of rules) ruleConfig[ts && !core && r === "no-redeclare" ? "@typescript-eslint/no-redeclare" : r] = "error";
	const config = {
		files: ["**/*.js", "**/*.cjs", "**/*.mjs", "**/*.jsx", "**/*.ts", "**/*.tsx", "**/*.cts", "**/*.mts"],
		plugins: plugin ? { "@typescript-eslint": plugin } : {},
		languageOptions: { ecmaVersion: "latest", sourceType: type, globals, ...(parser ? { parser } : {}), parserOptions: { ecmaFeatures: { jsx: !ts || tsx } } },
		linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
		rules: ruleConfig,
	};
	const filename = ts ? (tsx ? "a.tsx" : type === "commonjs" ? "a.cts" : "a.ts") : type === "commonjs" ? "a.cjs" : "a.js";
	const messages = linter.verify(code, [config], { filename });
	const reports = messages.filter(m => m.fatal || m.ruleId).map(m => (m.fatal ? { fatal: m.message, line: m.line, column: m.column } : { rule: m.ruleId.replace("@typescript-eslint/", ""), line: m.line, column: m.column, endLine: m.endLine, endColumn: m.endColumn, message: m.message }));
	out.push({ code, reports });
	if (!json) {
		console.log(`#${index} ${JSON.stringify(code)}`);
		for (const r of reports) console.log(r.fatal ? `    FATAL ${r.line}:${r.column} ${r.fatal}` : `    ${r.rule} ${r.line}:${r.column}-${r.endLine}:${r.endColumn} ${r.message}`);
	}
});
if (json) console.log(JSON.stringify(out));
