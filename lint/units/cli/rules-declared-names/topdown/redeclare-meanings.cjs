// Research scratch of "rules-declared-names" (top-down): @typescript-eslint/no-redeclare (8.58.2) against the same rule with ONE
// change: a later declaration is reported only when an earlier declaration of the variable shares a meaning with it, the
// meanings being `isTypeDefinition` / `isVariableDefinition` of the scope manager of typescript-eslint.
// usage: node redeclare-meanings.cjs <list-of-files.txt | cases.json> [--show]
"use strict";
const fs = require("fs");
const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser"), tsPlugin = req("@typescript-eslint/eslint-plugin");
const MERGE = [[["ClassDeclaration", "TSInterfaceDeclaration", "TSModuleDeclaration"], "ClassDeclaration"], [["FunctionDeclaration", "TSModuleDeclaration"], "FunctionDeclaration"], [["TSEnumDeclaration", "TSModuleDeclaration"], "TSEnumDeclaration"]];
const proto = {
	create(context) {
		const sourceCode = context.sourceCode;
		function* declarations(variable) {
			let ids = variable.identifiers.map(id => ({ id, parent: id.parent.type, def: variable.defs.find(d => d.name === id) })).filter(i => i.parent !== "TSDeclareFunction");
			if (ids.length > 1) {
				const every = set => ids.every(i => set.includes(i.parent));
				if (every(["TSInterfaceDeclaration"]) || every(["TSModuleDeclaration"])) return;
				for (const [set, kind] of MERGE) if (every(set)) { const main = ids.filter(i => i.parent === kind); if (main.length !== 1) yield* main; return; }
			}
			yield* ids;
		}
		function check(scope) {
			for (const variable of scope.variables) {
				const list = [...declarations(variable)];
				list.forEach((d, i) => {
					if (i === 0) return;
					const shares = list.slice(0, i).some(e => !e.def || !d.def || (e.def.isTypeDefinition && d.def.isTypeDefinition) || (e.def.isVariableDefinition && d.def.isVariableDefinition));
					if (shares) context.report({ node: d.id, message: `'${variable.name}' is already defined.` });
				});
			}
		}
		const block = node => { const scope = sourceCode.getScope(node); if (scope.block === node) check(scope); };
		return { Program(node) { const scope = sourceCode.getScope(node); check(scope); if (scope.type === "global" && scope.childScopes[0] && scope.block === scope.childScopes[0].block) check(scope.childScopes[0]); }, ArrowFunctionExpression: block, BlockStatement: block, ForInStatement: block, ForOfStatement: block, ForStatement: block, FunctionDeclaration: block, FunctionExpression: block, SwitchStatement: block };
	},
};
const linter = new Linter({ configType: "flat" });
const args = process.argv.slice(2), show = args.includes("--show");
const input = args.find(a => !a.startsWith("--"));
const items = input.endsWith(".json") ? JSON.parse(fs.readFileSync(input, "utf8")).map((c, i) => ({ name: `#${i}`, code: typeof c === "string" ? c : c.code, ext: (typeof c === "string" ? null : c.ext) || "ts" })).filter(c => /ts/.test(c.ext)) : fs.readFileSync(input, "utf8").split("\n").filter(Boolean).map(f => ({ name: path.relative("/workspace/wt/cli", f), file: f, ext: /\.d\.[cm]?ts$/.test(f) ? "d.ts" : path.extname(f).slice(1) }));
let plugin = 0, filtered = 0, filesPlugin = 0, filesFiltered = 0, n = 0;
for (const item of items) {
	const code = item.code ?? fs.readFileSync(item.file, "utf8");
	const config = [{ files: ["**/*.{ts,tsx,mts,cts}"], plugins: { "@typescript-eslint": tsPlugin, p: { rules: { proto } } }, languageOptions: { ecmaVersion: "latest", sourceType: /^(d\.)?cts$/.test(item.ext) ? "commonjs" : "module", parser: tsParser, parserOptions: { ecmaFeatures: { jsx: item.ext === "tsx" } } }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { "@typescript-eslint/no-redeclare": "error", "p/proto": "error" } }];
	let messages;
	try { messages = linter.verify(code, config, { filename: "c." + item.ext }); } catch { continue; }
	if (messages.some(m => m.fatal)) continue;
	n++;
	const a = messages.filter(m => m.ruleId === "@typescript-eslint/no-redeclare"), b = messages.filter(m => m.ruleId === "p/proto");
	plugin += a.length; filtered += b.length; if (a.length) filesPlugin++; if (b.length) filesFiltered++;
	const key = m => `${m.line}:${m.column} ${m.message}`;
	const kept = new Set(b.map(key));
	const extra = b.filter(m => !a.some(x => key(x) === key(m)));
	if (extra.length) console.log("NOT A SUBSET", item.name, extra.map(key));
	if (show && a.length) console.log(`${item.name}: the plugin ${a.length}, with meanings ${b.length}` + (item.code ? `  ${JSON.stringify(item.code).slice(0, 150)}\n     dropped: ${a.filter(m => !kept.has(key(m))).map(key).join(" | ")}` : ""));
}
console.log(`files ${n}: the plugin reports ${plugin} in ${filesPlugin} files, with meanings ${filtered} in ${filesFiltered} files`);
