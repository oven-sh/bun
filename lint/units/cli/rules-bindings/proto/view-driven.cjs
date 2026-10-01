// Research prototype of "rules-bindings": seven rules written as ONE pass over the scopes and variables of the scope
// manager (no node handler, no parent link, no getDeclaredVariables), compared with the rules of ESLint and, with --ts,
// with @typescript-eslint/no-redeclare. What a rule reads here is what it reads of the view in Rust:
// scope.type, scope.block.type, variable.defs[i].{type, name, node.type, parent.type, node.init}, variable.references[i].{identifier, isWrite(), init}.
// usage: node view-driven.cjs [--ts] [--type module|commonjs|script] [--show] <cases.json | code>...
"use strict";
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const RESTRICTED = new Set(["undefined", "NaN", "Infinity", "arguments", "eval", "globalThis"]);
const REAL_FUNCTION = new Set(["FunctionDeclaration", "FunctionExpression"]);
const ANY_FUNCTION = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

function make(ts) {
	return {
		meta: {},
		create(context) {
			const sourceCode = context.sourceCode;
			const report = (rule, node, message) => context.report({ node, message: `${rule}|${message}` });
			const reportLoc = (rule, loc, message) => context.report({ loc, message: `${rule}|${message}` });
			// A reference that modifies: a write that is no initializer, once for an identifier.
			function modifying(variable) {
				const out = [];
				let last = null;
				for (const ref of variable.references) {
					const first = ref.identifier !== last;
					last = ref.identifier;
					if (first && ref.isWrite() && ref.init === false) out.push(ref);
				}
				return out;
			}
			// `id.parent.type` of typescript-eslint's no-redeclare, from the definition alone.
			function parentKind(def) {
				switch (def.type) {
					case "FunctionName": return def.node.type === "TSDeclareFunction" ? "TSDeclareFunction" : def.node.type === "FunctionDeclaration" ? "FunctionDeclaration" : "other";
					case "ClassName": return def.node.type === "ClassDeclaration" ? "ClassDeclaration" : "other";
					case "TSEnumName": return "TSEnumDeclaration";
					case "TSModuleName": return "TSModuleDeclaration";
					case "Type": return def.node.type === "TSInterfaceDeclaration" ? "TSInterfaceDeclaration" : "other";
					default: return "other";
				}
			}
			function declarations(variable) {
				const out = [];
				if (variable.eslintImplicitGlobalSetting === "readonly" || variable.eslintImplicitGlobalSetting === "writable") out.push({ type: "builtin" });
				let ids = variable.defs.filter(d => d.name).map(d => ({ id: d.name, parent: parentKind(d) }));
				if (ts) {
					ids = ids.filter(i => i.parent !== "TSDeclareFunction");
					if (ids.length > 1) {
						const every = set => ids.every(i => set.includes(i.parent));
						const only = kind => ids.filter(i => i.parent === kind);
						if (every(["TSInterfaceDeclaration"]) || every(["TSModuleDeclaration"])) return out;
						for (const [set, kind] of [[["ClassDeclaration", "TSInterfaceDeclaration", "TSModuleDeclaration"], "ClassDeclaration"], [["FunctionDeclaration", "TSModuleDeclaration"], "FunctionDeclaration"], [["TSEnumDeclaration", "TSModuleDeclaration"], "TSEnumDeclaration"]]) {
							if (every(set)) {
								const main = only(kind);
								if (main.length !== 1) for (const i of main) out.push({ type: "syntax", id: i.id });
								return out;
							}
						}
					}
				}
				for (const i of ids) out.push({ type: "syntax", id: i.id });
				return out;
			}
			const CHECKED = new Set(["Program", "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "BlockStatement", "ForStatement", "ForInStatement", "ForOfStatement", "SwitchStatement", ...(ts ? [] : ["StaticBlock"])]);
			function redeclareChecked(scope) {
				if (scope.type === "function-expression-name" || scope.type === "class" || scope.type === "catch" || scope.type === "with" || scope.type === "class-field-initializer") return false;
				return CHECKED.has(scope.block.type) && ["global", "module", "function", "block", "for", "switch", "class-static-block"].includes(scope.type);
			}
			return {
				"Program:exit"() {
					const reported = new Set();
					for (const scope of sourceCode.scopeManager.scopes) {
						for (const variable of scope.variables) {
							const defs = variable.defs;
							if (defs.some(d => d.type === "ClassName")) for (const ref of modifying(variable)) report("no-class-assign", ref.identifier, `'${ref.identifier.name}' is a class.`);
							if (defs.some(d => d.type === "CatchClause")) for (const ref of modifying(variable)) report("no-ex-assign", ref.identifier, "Do not assign to the exception parameter.");
							if (defs.length && defs[0].type === "FunctionName" && defs.some(d => d.type === "FunctionName" && REAL_FUNCTION.has(d.node.type))) for (const ref of modifying(variable)) report("no-func-assign", ref.identifier, `'${ref.identifier.name}' is a function.`);
							if (scope.type === "global" && variable.writeable === false) for (const ref of modifying(variable)) report("no-global-assign", ref.identifier, `Read-only global '${ref.identifier.name}' should not be modified.`);
							if (RESTRICTED.has(variable.name) && defs.length) {
								const covered = defs.some(d =>
									d.type === "Variable" ||
									d.type === "CatchClause" ||
									(d.type === "ClassName" && (d.node.type === "ClassDeclaration" || d.node.type === "ClassExpression")) ||
									(d.type === "ImportBinding" && d.parent && d.parent.type === "ImportDeclaration") ||
									(d.type === "FunctionName" && REAL_FUNCTION.has(d.node.type)) ||
									(d.type === "Parameter" && ANY_FUNCTION.has(d.node.type)));
								const safe = variable.name === "undefined" && variable.references.every(r => !r.isWrite()) && defs.every(d => d.node.type === "VariableDeclarator" && d.node.init === null);
								if (covered && !safe) for (const d of defs) if (!reported.has(d.name)) { reported.add(d.name); report("no-shadow-restricted-names", d.name, `Shadowing of global property '${variable.name}'.`); }
							}
						}
						if (redeclareChecked(scope)) {
							for (const variable of scope.variables) {
								const [first, ...extra] = declarations(variable);
								for (const e of extra) {
									const text = e.type === first.type ? "is already defined." : first.type === "builtin" ? "is already defined as a built-in global variable." : "is already defined by a variable declaration.";
									report("no-redeclare", e.id, `'${variable.name}' ${text}`);
								}
							}
						}
						if (scope.type === "function" && REAL_FUNCTION.has(scope.block.type)) {
							const fn = scope.block;
							const paren = fn.id ? sourceCode.getTokenAfter(fn.id, t => t.value === "(" && t.type === "Punctuator") : sourceCode.getFirstToken(fn, t => t.value === "(" && t.type === "Punctuator");
							const check = variable => { if (variable.defs.filter(d => d.type === "Parameter").length >= 2) reportLoc("no-dupe-args", paren.loc, `Duplicate param '${variable.name}'.`); };
							// The variable of the name of a function declaration is a variable of the scope around it.
							if (fn.type === "FunctionDeclaration" && fn.id) { const named = scope.upper.set.get(fn.id.name); if (named && named.defs.some(d => d.node === fn)) check(named); }
							for (const variable of scope.variables) if (variable.defs.some(d => d.type === "Parameter")) check(variable);
						}
					}
				},
			};
		},
	};
}

const RULES = ["no-class-assign", "no-ex-assign", "no-func-assign", "no-global-assign", "no-shadow-restricted-names", "no-redeclare", "no-dupe-args"];
const args = process.argv.slice(2);
const ts = args.includes("--ts"), show = args.includes("--show");
let type = "module";
const cases = [];
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a === "--type") { type = args[++i]; continue; }
	if (a.startsWith("--")) continue;
	if (a.endsWith(".json")) {
		const j = JSON.parse(fs.readFileSync(a, "utf8"));
		for (const c of Array.isArray(j) ? j : [...j.valid, ...j.invalid]) cases.push(typeof c === "string" ? { code: c } : { code: c.code });
	} else cases.push({ code: a });
}
const globals = {};
for (const g of fs.readFileSync("/workspace/notes/lint/units/cli/name-resolution/oracle/bun-globals.txt", "utf8").split("\n").filter(l => !l.startsWith("#")).join(" ").split(/\s+/).filter(Boolean)) globals[g.replace(/:w$/, "")] = g.endsWith(":w") ? "writable" : "readonly";
const req = require("module").createRequire("/workspace/ref/tseslint/package.json");
const parser = ts ? req("@typescript-eslint/parser") : undefined;
const plugin = ts ? req("@typescript-eslint/eslint-plugin") : undefined;
const linter = new Linter({ configType: "flat" });
let equal = 0, differ = 0, fatal = 0, reports = 0;
const seen = new Set();
for (const c of cases) {
	if (seen.has(c.code)) continue;
	seen.add(c.code);
	const base = { files: ["**/*.js", "**/*.cjs", "**/*.ts", "**/*.cts"], plugins: { p: { rules: { proto: make(ts) } }, ...(plugin ? { "@typescript-eslint": plugin } : {}) }, languageOptions: { ecmaVersion: "latest", sourceType: type, globals, ...(parser ? { parser } : {}) }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" } };
	const filename = ts ? "a.ts" : type === "commonjs" ? "a.cjs" : "a.js";
	const real = linter.verify(c.code, [{ ...base, rules: Object.fromEntries(RULES.map(r => [ts && r === "no-redeclare" ? "@typescript-eslint/no-redeclare" : r, "error"])) }], { filename });
	const mine = linter.verify(c.code, [{ ...base, rules: { "p/proto": "error" } }], { filename });
	if (real.some(m => m.fatal)) { fatal++; continue; }
	const want = [...new Set(real.filter(m => m.ruleId).map(m => `${m.line}:${m.column} ${m.ruleId.replace("@typescript-eslint/", "")}: ${m.message}`))].sort();
	const got = [...new Set(mine.filter(m => m.ruleId).map(m => { const [rule, text] = m.message.split("|"); return `${m.line}:${m.column} ${rule}: ${text}`; }))].sort();
	reports += want.length;
	if (JSON.stringify(want) === JSON.stringify(got)) { equal++; if (show) console.log("same", JSON.stringify(c.code), want); }
	else { differ++; console.log("DIFFER", JSON.stringify(c.code), "\n   eslint:", want, "\n   proto: ", got); }
}
console.log(`${ts ? "ts" : type}: cases ${seen.size}: same ${equal}, different ${differ}, ESLint's parser rejects ${fatal}; ${reports} reports of ESLint`);
