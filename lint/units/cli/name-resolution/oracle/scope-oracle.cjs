// Research scratch of "name-resolution": what ESLint's scope analysis says of a snippet.
// usage: node scope-oracle.cjs [--type module|commonjs|script] [--ts|--tsx] [--globals a,b] [--rules r1,r2] <code | file.json>...
// For each code: every scope (type, block, variables with defs, identifiers and references), the references that reach the
// global scope unresolved, and what the named rules report. A .json argument is an array of codes.
// --ts / --tsx: @typescript-eslint/parser (and its scope manager) in place of espree and eslint-scope.
"use strict";
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const args = process.argv.slice(2);
let type = "module", ts = false, tsx = false, globals = {}, rules = [];
const codes = [];
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a === "--type") type = args[++i];
	else if (a === "--ts") ts = true;
	else if (a === "--tsx") ts = tsx = true;
	else if (a === "--globals") for (const g of args[++i].split(",")) globals[g] = "readonly";
	else if (a === "--rules") rules = args[++i].split(",");
	else if (a.endsWith(".json")) codes.push(...JSON.parse(fs.readFileSync(a, "utf8")).map(c => (typeof c === "string" ? c : c.code)));
	else codes.push(a);
}
const parser = ts ? require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser") : undefined;
const at = n => (n && n.loc ? `${n.loc.start.line}:${n.loc.start.column + 1}` : "-");
const lines = [];
const dump = {
	create(context) {
		return {
			"Program:exit"() {
				const sm = context.sourceCode.scopeManager;
				const index = new Map(sm.scopes.map((s, i) => [s, i]));
				sm.scopes.forEach((s, i) => {
					lines.push(`scope#${i} ${s.type} ${s.block.type}@${at(s.block)} upper=${s.upper ? index.get(s.upper) : "-"} variableScope=${index.get(s.variableScope)} strict=${s.isStrict}${s.functionExpressionScope ? " fn-expr-name" : ""}`);
					for (const v of s.variables) {
						const defs = v.defs.map(d => `${d.type}@${at(d.name)}`).join(",");
						const ids = v.identifiers.map(at).join(",");
						const refs = v.references.map(r => `${at(r.identifier)}${r.isRead() ? "r" : ""}${r.isWrite() ? "w" : ""}${r.init ? "i" : ""}${r.isTypeReference ? "T" : ""}${r.isValueReference === false ? "" : ""}`).join(",");
						const extra = [v.writeable === false ? "readonly-global" : "", v.eslintImplicitGlobalSetting ? `builtin:${v.eslintImplicitGlobalSetting}` : "", v.isTypeVariable !== undefined ? `${v.isTypeVariable ? "T" : ""}${v.isValueVariable ? "V" : ""}` : ""].filter(Boolean).join(" ");
						if (s.type === "global" && v.defs.length === 0 && v.references.length === 0) continue;
						lines.push(`  var ${v.name} defs=[${defs}] ids=[${ids}] refs=[${refs}] ${extra}`);
					}
				});
				lines.push(`through=[${sm.scopes[0].through.map(r => `${r.identifier.name}@${at(r.identifier)}`).join(",")}]`);
			},
		};
	},
};
const linter = new Linter({ configType: "flat" });
for (const code of codes) {
	lines.length = 0;
	const config = {
		files: ["**/*"],
		plugins: { probe: { rules: { dump } } },
		languageOptions: { ecmaVersion: "latest", sourceType: type, globals, ...(parser ? { parser } : {}), parserOptions: { ecmaFeatures: { jsx: !ts || tsx } } },
		rules: { "probe/dump": "error", ...Object.fromEntries(rules.map(r => [r, "error"])) },
	};
	const messages = linter.verify(code, [config], { filename: ts ? (tsx ? "a.tsx" : "a.ts") : type === "commonjs" ? "a.cjs" : "a.js" });
	console.log("== " + JSON.stringify(code));
	for (const l of lines) console.log(l);
	for (const m of messages) console.log(`  ${m.fatal ? "FATAL" : m.ruleId} ${m.line}:${m.column} ${m.message}`);
}
