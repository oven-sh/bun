// Research scratch of "rule-no-unused-vars": what ESLint at the pin says of a snippet for no-unused-vars.
// usage: node o.cjs [--ext js|jsx|mjs|cjs|ts|tsx|mts|cts|d.ts] [--type script|module|commonjs] [--core] [--both] [--scope] [--inline] <code | file.json>...
//   JavaScript: the core rule. TypeScript: @typescript-eslint/no-unused-vars (--core: the core rule on typescript-eslint's tree; --both: the two).
//   Comments configure nothing (noInlineConfig) unless --inline. --scope: the variables and references of the scope manager.
"use strict";
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const tsPlugin = req("@typescript-eslint/eslint-plugin");
const args = process.argv.slice(2);
let ext = "js", type = null, core = false, both = false, scope = false, inline = false;
const codes = [];
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a === "--ext") ext = args[++i];
	else if (a === "--type") type = args[++i];
	else if (a === "--core") core = true;
	else if (a === "--both") both = true;
	else if (a === "--scope") scope = true;
	else if (a === "--inline") inline = true;
	else if (a.endsWith(".json")) codes.push(...JSON.parse(fs.readFileSync(a, "utf8")).map(c => (typeof c === "string" ? c : c.code)));
	else codes.push(a);
}
const isTs = /^(d\.)?[cm]?tsx?$/.test(ext) || ext === "d.ts";
const at = n => (n && n.loc ? `${n.loc.start.line}:${n.loc.start.column + 1}` : "-");
const lines = [];
const dump = {
	create(context) {
		return {
			"Program:exit"() {
				const sm = context.sourceCode.scopeManager;
				const index = new Map(sm.scopes.map((s, i) => [s, i]));
				sm.scopes.forEach((s, i) => {
					const vars = s.variables.filter(v => !(s.type === "global" && v.defs.length === 0 && v.references.length === 0));
					lines.push(`  scope#${i} ${s.type} ${s.block.type}@${at(s.block)} upper=${s.upper ? index.get(s.upper) : "-"} varScope=${index.get(s.variableScope)}`);
					for (const v of vars) {
						const defs = v.defs.map(d => `${d.type}@${at(d.name)}`).join(",");
						const refs = v.references.map(r => `${at(r.identifier)}${r.isRead() ? "r" : ""}${r.isWrite() ? "w" : ""}${r.init ? "i" : ""}${r.isTypeReference ? "T" : ""}${r.isValueReference ? "V" : ""}@s${index.get(r.from)}`).join(",");
						lines.push(`    var ${v.name} defs=[${defs}] refs=[${refs}]${v.eslintUsed ? " eslintUsed" : ""}${v.isTypeVariable !== undefined ? ` ${v.isTypeVariable ? "T" : ""}${v.isValueVariable ? "V" : ""}` : ""}`);
					}
				});
				lines.push(`  through=[${sm.scopes[0].through.map(r => `${r.identifier.name}@${at(r.identifier)}`).join(",")}]`);
			},
		};
	},
};
const linter = new Linter({ configType: "flat" });
function run(code, rule) {
	lines.length = 0;
	const sourceType = type || (ext === "cjs" || ext === "cts" ? "commonjs" : ext === "js" || ext === "jsx" ? "script" : "module");
	const jsx = ext === "jsx" || ext === "tsx";
	const languageOptions = isTs ? { parser: tsParser, ecmaVersion: "latest", sourceType } : { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } };
	const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions, plugins: { "@typescript-eslint": tsPlugin, probe: { rules: { dump } } }, linterOptions: { noInlineConfig: !inline, reportUnusedDisableDirectives: "off" }, rules: { [rule]: "error", ...(scope ? { "probe/dump": "error" } : {}) } }];
	const messages = linter.verify(code, config, { filename: `c.${ext}` });
	return messages.filter(m => m.fatal || m.ruleId === rule).map(m => (m.fatal ? `FATAL ${m.line}:${m.column} ${m.message}` : `${m.line}:${m.column} ${m.message}`));
}
for (const code of codes) {
	console.log("== " + JSON.stringify(code) + ` [${ext}${type ? " " + type : ""}]`);
	const first = isTs && !core ? "@typescript-eslint/no-unused-vars" : "no-unused-vars";
	const out = run(code, first);
	if (scope) for (const l of lines) console.log(l);
	console.log(`  ${first === "no-unused-vars" ? "core" : "ts-eslint"}: ${out.length ? out.join(" | ") : "(none)"}`);
	if (isTs && both) {
		const o2 = run(code, "no-unused-vars");
		console.log(`  core: ${o2.length ? o2.join(" | ") : "(none)"}`);
	}
}
