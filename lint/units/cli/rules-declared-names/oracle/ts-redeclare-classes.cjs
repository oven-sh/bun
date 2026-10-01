// Research scratch: the reports of @typescript-eslint/no-redeclare over real TypeScript files, by what is declared twice.
"use strict";
const fs = require("fs"), path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/package.json");
const parser = req("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const out = { files: 0, filesWith: 0, variables: 0, valueTwice: 0, typeValuePair: 0, other: 0 };
const samples = { typeValuePair: [], other: [] };
const probe = {
	create(context) {
		return {
			"Program:exit"() {
				const kinds = ["global", "module", "function", "block", "for", "switch"];
				let any = false;
				for (const scope of context.sourceCode.scopeManager.scopes) {
					if (!kinds.includes(scope.type)) continue;
					if (scope.type === "function" && !/Function|Program/.test(scope.block.type)) continue;
					for (const v of scope.variables) {
						const ids = v.identifiers.filter(id => id.parent.type !== "TSDeclareFunction");
						if (ids.length < 2) continue;
						const t = new Set(ids.map(id => id.parent.type));
						const all = (...names) => [...t].every(x => names.includes(x));
						const count = name => ids.filter(id => id.parent.type === name).length;
						if (all("TSInterfaceDeclaration") || all("TSModuleDeclaration")) continue;
						if (all("ClassDeclaration", "TSInterfaceDeclaration", "TSModuleDeclaration") && count("ClassDeclaration") === 1) continue;
						if (all("FunctionDeclaration", "TSModuleDeclaration") && count("FunctionDeclaration") === 1) continue;
						if (all("TSEnumDeclaration", "TSModuleDeclaration") && count("TSEnumDeclaration") === 1) continue;
						out.variables++; any = true;
						{
							// Variant B': names of types and of imports do not count.
							const kept = ids.filter(id => !["TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSTypeParameter", "ImportSpecifier", "ImportDefaultSpecifier", "ImportNamespaceSpecifier"].includes(id.parent.type));
							const tk = new Set(kept.map(id => id.parent.type));
							const allk = (...names) => [...tk].every(x => names.includes(x));
							const countk = name => kept.filter(id => id.parent.type === name).length;
							let reported = kept.length >= 2;
							if (reported && allk("TSModuleDeclaration")) reported = false;
							if (reported && allk("ClassDeclaration", "TSModuleDeclaration") && countk("ClassDeclaration") === 1) reported = false;
							if (reported && allk("FunctionDeclaration", "TSModuleDeclaration") && countk("FunctionDeclaration") === 1) reported = false;
							if (reported && allk("TSEnumDeclaration", "TSModuleDeclaration") && countk("TSEnumDeclaration") === 1) reported = false;
							if (reported) { out.variantB = (out.variantB || 0) + 1; if (!(v.defs.filter(d => d.node.type !== "TSDeclareFunction").filter(d => d.isVariableDefinition && !(d.type === "ImportBinding")).length >= 2)) (out.variantBOdd = out.variantBOdd || []).push(`${context.filename} ${v.name}: ${kept.map(id => id.parent.type).join("+")}`); }
						}
						const defs = v.defs.filter(d => d.node.type !== "TSDeclareFunction");
						const values = defs.filter(d => d.isVariableDefinition && !(d.type === "ImportBinding" && d.node.importKind === "type") && !(d.type === "ImportBinding" && d.parent && d.parent.importKind === "type")).length;
						const types = defs.filter(d => d.isTypeDefinition && !d.isVariableDefinition).length;
						if (values >= 2) out.valueTwice++;
						else if (types >= 1 && values <= 1) { out.typeValuePair++; if (samples.typeValuePair.length < 12) samples.typeValuePair.push(`${context.filename} ${v.name}: ${defs.map(d => d.node.type).join("+")}`); }
						else { out.other++; if (samples.other.length < 12) samples.other.push(`${context.filename} ${v.name}: ${defs.map(d => d.type + "/" + d.node.type).join("+")}`); }
					}
				}
				if (any) out.filesWith++;
			},
		};
	},
};
const files = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).filter(f => /\.[cm]?tsx?$/.test(f));
for (const f of files) {
	let code; try { code = fs.readFileSync(path.join("/workspace/wt/cli", f), "utf8"); } catch { continue; }
	if (code.length > 400000) continue;
	const ext = path.extname(f).slice(1);
	out.files++;
	try { linter.verify(code, [{ files: ["**/*.{ts,tsx,mts,cts}"], plugins: { p: { rules: { probe } } }, languageOptions: { ecmaVersion: "latest", sourceType: "module", parser, parserOptions: { ecmaFeatures: { jsx: ext === "tsx" } } }, rules: { "p/probe": "error" } }], { filename: f }); } catch {}
}
console.log(JSON.stringify(out), "\n", samples.typeValuePair.join("\n "), "\nOTHER\n", samples.other.join("\n "));
