// Research scratch of "rules-unused": what ESLint at the pin says of a snippet for no-unused-private-class-members.
// usage: node nupcm-oracle.cjs [--ext js|jsx|mjs|cjs|ts|tsx|mts|cts] [--ts-rule] [--ast] <code | list.json>...
//   JavaScript: the core rule on espree (a module; commonjs when the parser rejects that).
//   TypeScript: the core rule on the tree of typescript-eslint's parser. --ts-rule: also @typescript-eslint/no-unused-private-class-members.
//   A list is an array of strings or of { code, ext? }. Comments configure nothing (noInlineConfig).
"use strict";
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const tsPlugin = req("@typescript-eslint/eslint-plugin");
const RULE = "no-unused-private-class-members";
const linter = new Linter({ configType: "flat" });
const isTsExt = ext => /^[cm]?tsx?$/.test(ext);

function verify(code, ext, rule, sourceType) {
	const jsx = ext === "jsx" || ext === "tsx";
	const languageOptions = isTsExt(ext)
		? { parser: tsParser, ecmaVersion: "latest", sourceType }
		: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } };
	const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions, plugins: { "@typescript-eslint": tsPlugin }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { [rule]: "error" } }];
	return linter.verify(code, config, { filename: `c.${ext}` });
}

// The reports of the rule as `line:column message`, or one `FATAL ...` line.
function ask(code, ext, rule = RULE) {
	const types = ext === "cjs" || ext === "cts" ? ["commonjs"] : isTsExt(ext) || ext === "mjs" ? ["module"] : ["module", "commonjs"];
	let messages = [];
	for (const type of types) {
		messages = verify(code, ext, rule, type);
		if (!messages.some(m => m.fatal)) break;
	}
	const fatal = messages.find(m => m.fatal);
	if (fatal) return [`FATAL ${fatal.line}:${fatal.column} ${fatal.message}`];
	return messages.filter(m => m.ruleId === rule).map(m => `${m.line}:${m.column} ${m.message}`);
}
module.exports = { ask, isTsExt, RULE };

if (require.main === module) {
	const args = process.argv.slice(2);
	let ext = "js", tsRule = false, ast = false;
	const cases = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--ext") ext = args[++i];
		else if (a === "--ts-rule") tsRule = true;
		else if (a === "--ast") ast = true;
		else if (a.endsWith(".json")) cases.push(...JSON.parse(fs.readFileSync(a, "utf8")).map(c => (typeof c === "string" ? { code: c, ext } : { code: c.code, ext: c.ext || ext })));
		else cases.push({ code: a, ext });
	}
	for (const c of cases) {
		console.log("== " + JSON.stringify(c.code) + ` [${c.ext}]`);
		const out = ask(c.code, c.ext);
		console.log(`  core: ${out.length ? out.join(" | ") : "(none)"}`);
		if (tsRule && isTsExt(c.ext)) {
			const o2 = ask(c.code, c.ext, "@typescript-eslint/no-unused-private-class-members");
			console.log(`  ts-eslint: ${o2.length ? o2.join(" | ") : "(none)"}`);
		}
		if (ast) {
			const parser = isTsExt(c.ext) ? tsParser : require("/workspace/ref/eslint/node_modules/espree");
			const tree = isTsExt(c.ext) ? parser.parseForESLint(c.code, { ecmaVersion: "latest", sourceType: "module", filePath: `c.${c.ext}` }).ast : parser.parse(c.code, { ecmaVersion: "latest", sourceType: "module" });
			const seen = [];
			const walk = (n, depth) => {
				if (!n || typeof n.type !== "string") return;
				seen.push("  ".repeat(depth) + n.type + (n.kind ? ` kind=${n.kind}` : "") + (n.name ? ` ${n.name}` : ""));
				for (const k of Object.keys(n)) {
					if (k === "parent" || k === "loc" || k === "range" || k === "tokens" || k === "comments") continue;
					const v = n[k];
					if (Array.isArray(v)) v.forEach(x => walk(x, depth + 1));
					else if (v && typeof v.type === "string") walk(v, depth + 1);
				}
			};
			walk(tree, 1);
			console.log(seen.join("\n"));
		}
	}
}
