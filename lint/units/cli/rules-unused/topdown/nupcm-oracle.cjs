// Research scratch of "rules-unused" (pass 1b): what ESLint at the pin says of a snippet for no-unused-private-class-members.
// usage: node nupcm-oracle.cjs [--ext js|jsx|mjs|cjs|ts|tsx|mts|cts|d.ts] [--ts-rule] [--tree] [--json] <code | cases.json>...
//   JavaScript: the core rule on espree. TypeScript: the core rule on the tree of typescript-eslint's parser (what a
//   project on eslint:recommended + typescript-eslint/recommended runs). --ts-rule: also the rule of the same name of
//   typescript-eslint, which only its `all` configuration turns on. --tree: the parents of each PrivateIdentifier.
//   a .json is ["code"] or [{code, ext}] or {valid:[...], invalid:[...]} of ESLint's RuleTester.
"use strict";
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const tsPlugin = req("@typescript-eslint/eslint-plugin");
const args = process.argv.slice(2);
let ext = null, tsRule = false, tree = false, json = false;
const inputs = [];
const push = (c, from) => inputs.push(typeof c === "string" ? { code: c } : { code: c.code, ext: c.ext });
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a === "--ext") ext = args[++i];
	else if (a === "--ts-rule") tsRule = true;
	else if (a === "--tree") tree = true;
	else if (a === "--json") json = true;
	else if (a.endsWith(".json")) {
		const j = JSON.parse(fs.readFileSync(a, "utf8"));
		if (Array.isArray(j)) j.forEach(push);
		else for (const k of ["valid", "invalid"]) (j[k] || []).forEach(push);
	} else inputs.push({ code: a });
}
const linter = new Linter({ configType: "flat" });
const lines = [];
const dump = {
	create() {
		return {
			PrivateIdentifier(node) {
				const chain = [];
				for (let n = node.parent, i = 0; n && i < 4; n = n.parent, i++) chain.push(n.type);
				lines.push(`  #${node.name}@${node.loc.start.line}:${node.loc.start.column + 1} <- ${chain.join(" <- ")}`);
			},
		};
	},
};
function run(code, e, rule) {
	lines.length = 0;
	const isTs = /^(d\.)?[cm]?tsx?$/.test(e);
	const sourceType = e === "cjs" || e === "cts" ? "commonjs" : e === "js" || e === "jsx" ? "script" : "module";
	const languageOptions = isTs ? { parser: tsParser, ecmaVersion: "latest", sourceType } : { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: e === "jsx" } } };
	const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions, plugins: { "@typescript-eslint": tsPlugin, probe: { rules: { dump } } }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { [rule]: "error", ...(tree ? { "probe/dump": "error" } : {}) } }];
	const messages = linter.verify(code, config, { filename: `c.${e}` });
	return messages.filter(m => m.fatal || m.ruleId === rule).map(m => (m.fatal ? `FATAL ${m.line}:${m.column} ${m.message}` : `${m.line}:${m.column} ${m.message}`));
}
const out = [];
for (const input of inputs) {
	const e = ext || input.ext || "js";
	const core = run(input.code, e, "no-unused-private-class-members");
	if (json) { out.push({ code: input.code, ext: e, core }); continue; }
	console.log("== " + JSON.stringify(input.code) + ` [${e}]`);
	if (tree) for (const l of lines) console.log(l);
	console.log(`  core: ${core.length ? core.join(" | ") : "(none)"}`);
	if (tsRule && /ts/.test(e)) {
		const t = run(input.code, e, "@typescript-eslint/no-unused-private-class-members");
		console.log(`  ts-eslint: ${t.length ? t.join(" | ") : "(none)"}`);
	}
}
if (json) console.log(JSON.stringify(out, null, "\t"));
