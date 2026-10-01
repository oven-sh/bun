// Research prototype of "rules-bindings": ReferenceTracker.iterateGlobalReferences for a trace map { K: { CALL, CONSTRUCT } }
// WITHOUT parent links: the value of a callee is read downwards, and the aliases are a fixpoint over the declarators,
// assignments and defaults of the file, each fact carrying the variable stack of the tracker. Compared with no-obj-calls of ESLint.
// usage: node tracker-down.cjs [--ts] [--show] <cases.json | code>...   (cases: codes, { code, languageOptions? }, or { valid, invalid })
"use strict";
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const eslintRequire = require("module").createRequire("/workspace/ref/eslint/package.json");
const { findVariable, getPropertyName } = eslintRequire("@eslint-community/eslint-utils");
const astUtils = require("/workspace/ref/eslint/lib/rules/utils/ast-utils");
const NAMES = ["Atomics", "JSON", "Math", "Reflect", "Intl", "Temporal"];
const GLOBAL_OBJECTS = ["global", "globalThis", "self", "window"];
const PASS_TS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSTypeAssertion", "TSNonNullExpression", "TSInstantiationExpression"]);

const proto = {
	meta: { messages: { unexpectedCall: "'{{name}}' is not a function.", unexpectedRefCall: "'{{name}}' is reference to '{{ref}}', which is not a function." } },
	create(context) {
		const sourceCode = context.sourceCode;
		return {
			"Program:exit"(program) {
				const globalScope = sourceCode.getScope(program);
				const keys = sourceCode.visitorKeys;
				const edges = [], calls = [];
				(function walk(node) {
					if (!node || typeof node.type !== "string") return;
					if (node.type === "VariableDeclarator" && node.init) edges.push([node.init, node.id]);
					else if (node.type === "AssignmentExpression" || node.type === "AssignmentPattern") edges.push([node.right, node.left]);
					else if (node.type === "CallExpression" || node.type === "NewExpression") calls.push(node);
					for (const key of keys[node.type] || []) {
						const child = node[key];
						if (Array.isArray(child)) child.forEach(walk);
						else walk(child);
					}
				})(program);
				// The read references of every variable, by identifier.
				const readOf = new Map();
				for (const scope of sourceCode.scopeManager.scopes) for (const variable of scope.variables) for (const ref of variable.references) if (ref.isRead()) readOf.set(ref.identifier, variable);
				const roots = new Map();
				for (const name of [...NAMES, ...GLOBAL_OBJECTS]) {
					const variable = globalScope.set.get(name);
					if (variable == null || variable.defs.length !== 0 || variable.references.some(r => r.isWrite())) continue;
					for (const ref of variable.references) if (ref.isRead()) roots.set(ref.identifier, { key: NAMES.includes(name) ? name : null, stack: [variable] });
				}
				const aliases = new Map();
				const same = (a, b) => a.key === b.key && a.stack.length === b.stack.length && a.stack.every((v, i) => v === b.stack[i]);
				function value(node) {
					switch (node.type) {
						case "Identifier": {
							const out = [];
							if (roots.has(node)) out.push(roots.get(node));
							const variable = readOf.get(node);
							if (variable && aliases.has(variable)) out.push(...aliases.get(variable));
							return out;
						}
						case "MemberExpression": {
							const key = getPropertyName(node);
							if (key == null || !NAMES.includes(key)) return [];
							return value(node.object).filter(f => f.key === null).map(f => ({ key, stack: f.stack }));
						}
						case "ConditionalExpression": return [...value(node.consequent), ...value(node.alternate)];
						case "LogicalExpression": return [...value(node.left), ...value(node.right)];
						case "SequenceExpression": return value(node.expressions.at(-1));
						case "ChainExpression": return value(node.expression);
						case "AssignmentExpression": return value(node.right);
						default: return PASS_TS.has(node.type) ? value(node.expression) : [];
					}
				}
				let changed = false;
				function lhs(pattern, fact) {
					if (pattern.type === "Identifier") {
						const variable = findVariable(globalScope, pattern);
						if (variable == null || fact.stack.includes(variable)) return;
						const next = { key: fact.key, stack: [...fact.stack, variable] };
						const list = aliases.get(variable) || [];
						if (!list.some(f => same(f, next))) { list.push(next); aliases.set(variable, list); changed = true; }
					} else if (pattern.type === "ObjectPattern") {
						for (const property of pattern.properties) {
							const key = getPropertyName(property);
							if (key == null || fact.key !== null || !NAMES.includes(key)) continue;
							lhs(property.value, { key, stack: fact.stack });
						}
					} else if (pattern.type === "AssignmentPattern") lhs(pattern.left, fact);
				}
				let rounds = 0;
				do {
					changed = false;
					for (const [right, left] of edges) for (const fact of value(right)) lhs(left, fact);
				} while (changed && ++rounds < 1000);
				function name(node) {
					if (node.type === "ChainExpression") return name(node.expression);
					if (node.type === "MemberExpression") return astUtils.getStaticPropertyName(node);
					return node.name;
				}
				for (const call of calls) {
					const seen = new Set();
					for (const fact of value(call.callee)) {
						if (fact.key === null || seen.has(fact.key)) continue;
						seen.add(fact.key);
						const n = name(call.callee);
						context.report({ node: call, messageId: n === fact.key ? "unexpectedCall" : "unexpectedRefCall", data: { name: n, ref: fact.key } });
					}
				}
			},
		};
	},
};

const args = process.argv.slice(2);
const ts = args.includes("--ts"), show = args.includes("--show");
const cases = [];
for (const a of args.filter(a => !a.startsWith("--"))) {
	if (a.endsWith(".json")) {
		const j = JSON.parse(fs.readFileSync(a, "utf8"));
		for (const c of Array.isArray(j) ? j : [...j.valid, ...j.invalid]) cases.push(typeof c === "string" ? { code: c } : c);
	} else cases.push({ code: a });
}
const globals = {};
for (const g of fs.readFileSync("/workspace/notes/lint/units/cli/name-resolution/oracle/bun-globals.txt", "utf8").split("\n").filter(l => !l.startsWith("#")).join(" ").split(/\s+/).filter(Boolean)) globals[g.replace(/:w$/, "")] = g.endsWith(":w") ? "writable" : "readonly";
const parser = ts ? require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser") : undefined;
const linter = new Linter({ configType: "flat" });
let equal = 0, differ = 0, fatal = 0, reports = 0;
for (const c of cases) {
	const lo = c.languageOptions ? { ...c.languageOptions } : { ecmaVersion: "latest", sourceType: "module", globals };
	if (lo.parser) continue;
	const run = rule => linter.verify(c.code, [{ files: ["**/*.js", "**/*.cjs", "**/*.mjs", "**/*.jsx", "**/*.ts", "**/*.tsx", "**/*.cts", "**/*.mts"], plugins: { p: { rules: { proto } } }, languageOptions: { ...lo, ...(parser ? { parser } : {}) }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { [rule]: "error" } }], { filename: ts ? "a.ts" : lo.sourceType === "commonjs" ? "a.cjs" : "a.js" });
	const norm = ms => [...new Set(ms.filter(m => m.ruleId || m.fatal).map(m => (m.fatal ? "FATAL" : `${m.line}:${m.column} ${m.message}`)))].sort();
	const want = norm(run("no-obj-calls")), got = norm(run("p/proto"));
	if (want[0] === "FATAL") { fatal++; continue; }
	reports += want.length;
	if (JSON.stringify(want) === JSON.stringify(got)) { equal++; if (show) console.log("same", JSON.stringify(c.code), want); }
	else { differ++; console.log("DIFFER", JSON.stringify(c.code), "\n   eslint:", want, "\n   proto: ", got); }
}
console.log(`cases ${cases.length}: same ${equal}, different ${differ}, ESLint's parser rejects ${fatal}; ${reports} reports of ESLint`);
