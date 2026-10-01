// Research prototype of "rules-declared-names": ten of the twelve rules as ONE pass over the tables of the scope analysis
// (scopes, variables, definitions, references, the unresolved references of the global scope), without getDeclaredVariables
// and without a handler per node. What a rule still asks of the tree is marked ASK: (a) the `(` of a function, (b) whether an
// identifier is the operand of `typeof`, (c) whether it is the callee of `new`, (d) the kind of the node that a definition
// belongs to. Compared with the rules of ESLint at the pin (and @typescript-eslint/no-redeclare in a TypeScript file).
// usage: node table-rules.cjs [--ts] [--type module|commonjs] [--show] <cases.json | code>...
//        node table-rules.cjs --corpus <list> <js|ts> [max]       real files under /workspace/wt/cli
"use strict";
const fs = require("fs"), path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const astUtils = require("/workspace/ref/eslint/lib/rules/utils/ast-utils");
const TEN = ["no-class-assign", "no-const-assign", "no-ex-assign", "no-func-assign", "no-redeclare", "no-shadow-restricted-names", "no-dupe-args", "no-global-assign", "no-undef", "no-new-native-nonconstructor"];
const RESTRICTED = new Set(["undefined", "NaN", "Infinity", "arguments", "eval", "globalThis"]);
const REAL_FUNCTION = new Set(["FunctionDeclaration", "FunctionExpression"]);
const ANY_FUNCTION = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const CONSTANT = new Set(["const", "using", "await using"]);
// The references of a variable that write and do not initialize; the second of two for one identifier is left out.
const modifying = refs => refs.filter((r, i) => r.identifier && r.init === false && r.isWrite() && (i === 0 || refs[i - 1].identifier !== r.identifier));
// ASK (d): whether the definition belongs to a node that no-shadow-restricted-names listens to.
function listened(def) {
	switch (def.type) {
		case "Variable": return def.parent && def.parent.type === "VariableDeclaration";
		case "FunctionName": case "Parameter": return ANY_FUNCTION.has(def.node.type);
		case "CatchClause": return def.node.type === "CatchClause";
		case "ImportBinding": return def.parent && def.parent.type === "ImportDeclaration";
		case "ClassName": return def.node.type === "ClassDeclaration" || def.node.type === "ClassExpression";
		default: return false;
	}
}
const proto = {
	meta: { messages: {} },
	create(context) {
		const sourceCode = context.sourceCode;
		const ts = /\.[cm]?tsx?$/.test(context.filename);
		const report = (rule, node, message, loc) => context.report({ node, ...(loc ? { loc } : {}), message: `${rule}|${message}` });
		return {
			"Program:exit"() {
				const manager = sourceCode.scopeManager;
				const globalScope = manager.scopes[0];
				for (const scope of manager.scopes) {
					for (const variable of scope.variables) {
						const defs = variable.defs;
						// no-class-assign
						if (defs.some(d => d.type === "ClassName")) for (const r of modifying(variable.references)) report("no-class-assign", r.identifier, `'${r.identifier.name}' is a class.`);
						// no-const-assign
						if (defs.some(d => d.type === "Variable" && d.parent && d.parent.type === "VariableDeclaration" && CONSTANT.has(d.parent.kind))) for (const r of modifying(variable.references)) report("no-const-assign", r.identifier, `'${r.identifier.name}' is constant.`);
						// no-ex-assign
						if (defs.some(d => d.type === "CatchClause")) for (const r of modifying(variable.references)) report("no-ex-assign", r.identifier, "Do not assign to the exception parameter.");
						// no-func-assign
						if (defs.length && defs[0].type === "FunctionName" && defs.some(d => (d.type === "FunctionName" || d.type === "Parameter") && REAL_FUNCTION.has(d.node.type))) for (const r of modifying(variable.references)) report("no-func-assign", r.identifier, `'${r.identifier.name}' is a function.`);
						// no-shadow-restricted-names
						if (defs.length && RESTRICTED.has(variable.name) && defs.some(listened)) {
							const safe = variable.name === "undefined" && variable.references.every(r => !r.isWrite()) && defs.every(d => d.node.type === "VariableDeclarator" && d.node.init === null);
							if (!safe) for (const name of new Set(defs.map(d => d.name))) report("no-shadow-restricted-names", name, `Shadowing of global property '${variable.name}'.`);
						}
						// no-dupe-args
						if (defs.filter(d => d.type === "Parameter").length >= 2) {
							for (const fn of new Set(defs.filter(d => (d.type === "Parameter" || d.type === "FunctionName") && REAL_FUNCTION.has(d.node.type)).map(d => d.node))) {
								// ASK (a)
								report("no-dupe-args", fn, `Duplicate param '${variable.name}'.`, { start: astUtils.getOpeningParenOfParams(fn, sourceCode).loc.start, end: sourceCode.getTokenBefore(fn.body).loc.end });
							}
						}
					}
					// no-redeclare
					const kinds = ts ? ["global", "module", "function", "block", "for", "switch"] : ["global", "module", "function", "class-static-block", "block", "for", "switch"];
					if (kinds.includes(scope.type)) {
						for (const variable of scope.variables) {
							const list = [];
							const builtin = variable.eslintImplicitGlobalSetting === "readonly" || variable.eslintImplicitGlobalSetting === "writable";
							if (builtin) list.push(null);
							let ids = variable.identifiers;
							if (ts) {
								// ASK (d): the kind of the declaration that each name belongs to.
								ids = ids.filter(id => id.parent.type !== "TSDeclareFunction");
								const all = set => ids.every(id => set.has(id.parent.type));
								const only = type => ids.filter(id => id.parent.type === type);
								if (ids.length > 1) {
									if (all(new Set(["TSInterfaceDeclaration"])) || all(new Set(["TSModuleDeclaration"]))) ids = [];
									else if (all(new Set(["ClassDeclaration", "TSInterfaceDeclaration", "TSModuleDeclaration"]))) ids = only("ClassDeclaration").length === 1 ? [] : only("ClassDeclaration");
									else if (all(new Set(["FunctionDeclaration", "TSModuleDeclaration"]))) ids = only("FunctionDeclaration").length === 1 ? [] : only("FunctionDeclaration");
									else if (all(new Set(["TSEnumDeclaration", "TSModuleDeclaration"]))) ids = only("TSEnumDeclaration").length === 1 ? [] : only("TSEnumDeclaration");
								}
							}
							list.push(...ids);
							for (const id of list.slice(1)) report("no-redeclare", id, builtin ? `'${variable.name}' is already defined as a built-in global variable.` : `'${variable.name}' is already defined.`);
						}
					}
				}
				// no-global-assign
				for (const variable of globalScope.variables) if (variable.writeable === false) for (const r of modifying(variable.references)) report("no-global-assign", r.identifier, `Read-only global '${r.identifier.name}' should not be modified.`);
				// no-undef; ASK (b)
				for (const r of globalScope.through) { const p = r.identifier.parent; if (!(p.type === "UnaryExpression" && p.operator === "typeof")) report("no-undef", r.identifier, `'${r.identifier.name}' is not defined.`); }
				// no-new-native-nonconstructor; ASK (c)
				for (const name of ["Symbol", "BigInt"]) { const v = globalScope.set.get(name); if (v && v.defs.length === 0) for (const r of v.references) { const p = r.identifier.parent; if (p && p.type === "NewExpression" && p.callee === r.identifier) report("no-new-native-nonconstructor", r.identifier, `\`${name}\` cannot be called as a constructor.`); } }
			},
		};
	},
};

const args = process.argv.slice(2);
let ts = args.includes("--ts"), show = args.includes("--show"), type = "module";
const rest = [];
for (let i = 0; i < args.length; i++) { if (args[i] === "--type") type = args[++i]; else if (!["--ts", "--show", "--corpus"].includes(args[i])) rest.push(args[i]); }
const globals = {};
for (const g of fs.readFileSync("/workspace/notes/lint/units/cli/name-resolution/oracle/bun-globals.txt", "utf8").split("\n").filter(l => !l.startsWith("#")).join(" ").split(/\s+/).filter(Boolean)) globals[g.replace(/:w$/, "")] = g.endsWith(":w") ? "writable" : "readonly";
const req = require("module").createRequire("/workspace/ref/tseslint/package.json");
const linter = new Linter({ configType: "flat" });
function both(code, ext, sourceType, isTs) {
	const parser = isTs ? req("@typescript-eslint/parser") : undefined;
	const plugin = isTs ? req("@typescript-eslint/eslint-plugin") : undefined;
	const base = { files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], plugins: { p: { rules: { proto } }, ...(plugin ? { "@typescript-eslint": plugin } : {}) }, languageOptions: { ecmaVersion: "latest", sourceType, globals, ...(parser ? { parser } : {}), parserOptions: { ecmaFeatures: { jsx: !isTs || ext === "tsx" } } }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" } };
	const real = linter.verify(code, [{ ...base, rules: Object.fromEntries(TEN.map(r => [isTs && r === "no-redeclare" ? "@typescript-eslint/no-redeclare" : r, "error"])) }], { filename: "a." + ext });
	if (real.some(m => m.fatal)) return null;
	const mine = linter.verify(code, [{ ...base, rules: { "p/proto": "error" } }], { filename: "a." + ext });
	const norm = list => [...new Set(list)].sort();
	const want = norm(real.filter(m => m.ruleId).map(m => `${m.line}:${m.column} ${m.ruleId.replace("@typescript-eslint/", "")}|${m.message}`));
	const got = norm(mine.filter(m => m.ruleId).map(m => `${m.line}:${m.column} ${m.message}`));
	const dupes = real.filter(m => m.ruleId).length - want.length;
	return { want, got, dupes };
}
let cases = 0, same = 0, differ = 0, fatal = 0, reports = 0, dupes = 0;
function check(code, ext, sourceType, isTs, label) {
	cases++;
	let r;
	try { r = both(code, ext, sourceType, isTs); } catch (e) { fatal++; return; }
	if (!r) { fatal++; return; }
	reports += r.want.length; dupes += r.dupes;
	if (JSON.stringify(r.want) === JSON.stringify(r.got)) { same++; if (show) console.log("same", label, r.want); }
	else { differ++; console.log("DIFFER", label, "\n   only eslint:", r.want.filter(x => !r.got.includes(x)).slice(0, 8), "\n   only proto: ", r.got.filter(x => !r.want.includes(x)).slice(0, 8)); }
}
if (args.includes("--corpus")) {
	const [list, kind, max] = rest;
	const files = fs.readFileSync(list, "utf8").split("\n").filter(Boolean).filter(f => (kind === "ts" ? /\.[cm]?tsx?$/.test(f) : /\.[cm]?jsx?$/.test(f))).slice(0, Number(max || 1e9));
	for (const f of files) {
		let code; try { code = fs.readFileSync(path.join("/workspace/wt/cli", f), "utf8"); } catch { continue; }
		if (code.length > 400000) continue;
		const ext = path.extname(f).slice(1);
		check(code, ext, /^c[jt]s$/.test(ext) ? "commonjs" : "module", kind === "ts", f);
	}
} else {
	for (const a of rest) {
		const list = a.endsWith(".json") ? (j => (Array.isArray(j) ? j : [...j.valid, ...j.invalid]))(JSON.parse(fs.readFileSync(a, "utf8"))) : [a];
		for (const c of list) { const code = typeof c === "string" ? c : c.code; check(code, ts ? (type === "commonjs" ? "cts" : "ts") : type === "commonjs" ? "cjs" : "js", type, ts, JSON.stringify(code).slice(0, 160)); }
	}
}
console.log(`cases ${cases}: same ${same}, different ${differ}, ESLint's parser rejects ${fatal}; ${reports} distinct reports of ESLint, ${dupes} more that repeat one`);
