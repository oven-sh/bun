// Research scratch of "rules-declared-names" (top-down): ESLint at the pin as a lint run of Bun is to answer after D4:
// the harness of D2 (../../ts-entry-codes-harness/topdown/tools/eslint-side.cjs: .cjs and .cts commonjs, every other extension a
// module, a TypeScript extension through @typescript-eslint/parser, the plugin rule in place of a core rule it extends) PLUS the
// table of globals-table.txt as `languageOptions.globals`.
// usage: node oracle.cjs [--no-table] [--core] [--json] <rule,rule> <cases.json>...   cases: codes or { code, ext }
"use strict";
const fs = require("fs");
const path = require("path");
const ESLINT = "/workspace/ref/eslint", TSESLINT = "/workspace/ref/tseslint";
const { Linter } = require(path.join(ESLINT, "lib/linter"));
const fromTs = require("module").createRequire(TSESLINT + "/");
const tsParser = fromTs("@typescript-eslint/parser"), tsPlugin = fromTs("@typescript-eslint/eslint-plugin");
const PLUGIN_RULES = Object.keys(tsPlugin.rules).filter(n => !tsPlugin.rules[n].meta.deprecated && tsPlugin.rules[n].meta.docs && tsPlugin.rules[n].meta.docs.extendsBaseRule === true);
const table = {};
for (const g of fs.readFileSync(path.join(__dirname, "globals-table.txt"), "utf8").split("\n").filter(l => !l.startsWith("#")).join(" ").split(/\s+/).filter(Boolean)) table[g.replace(/:w$/, "")] = g.endsWith(":w") ? "writable" : "readonly";
const linter = new Linter({ configType: "flat" });
const isTs = ext => /(^|\.)[cm]?tsx?$/.test(ext);
function verify(code, ext, rules, { core = false, noTable = false } = {}) {
	const ts = isTs(ext);
	const sourceType = /(^|\.)c[jt]s$/.test(ext) ? "commonjs" : "module";
	const named = r => (ts && !core && PLUGIN_RULES.includes(r) ? `@typescript-eslint/${r}` : r);
	const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], plugins: { "@typescript-eslint": tsPlugin }, languageOptions: { ecmaVersion: "latest", sourceType, globals: noTable ? {} : table, ...(ts ? { parser: tsParser } : {}), parserOptions: { ecmaFeatures: { jsx: ext === "jsx" || ext === "tsx" } } }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: Object.fromEntries(rules.map(r => [named(r), "error"])) }];
	const messages = linter.verify(code, config, { filename: `c.${ext}` });
	const fatal = messages.find(m => m.fatal);
	return { fatal: fatal ? `${fatal.line}:${fatal.column} ${fatal.message}` : null, reports: messages.filter(m => !m.fatal && m.ruleId).map(m => ({ rule: m.ruleId.replace("@typescript-eslint/", ""), line: m.line, column: m.column, message: m.message })) };
}
module.exports = { verify, table, PLUGIN_RULES };
if (require.main === module) {
	const args = process.argv.slice(2);
	const flags = { core: args.includes("--core"), noTable: args.includes("--no-table") };
	const json = args.includes("--json");
	const rest = args.filter(a => !a.startsWith("--"));
	const rules = rest.shift().split(",");
	const out = [];
	for (const file of rest) for (const raw of JSON.parse(fs.readFileSync(file, "utf8"))) {
		const c = typeof raw === "string" ? { code: raw } : raw;
		const ext = c.ext || (c.jsx ? "jsx" : "js");
		const r = verify(c.code, ext, rules, flags);
		out.push({ code: c.code, ext, ...r });
		if (!json) {
			console.log(`== [${ext}] ${JSON.stringify(c.code)}`);
			if (r.fatal) console.log(`   FATAL ${r.fatal}`);
			for (const m of r.reports) console.log(`   ${rules.length > 1 ? m.rule + " " : ""}${m.line}:${m.column} ${m.message}`);
		}
	}
	if (json) console.log(JSON.stringify(out, null, "\t"));
}
