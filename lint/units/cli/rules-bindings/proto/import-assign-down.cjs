// Research prototype of "rules-bindings": no-import-assign WITHOUT parent links. Every report is made at the node that
// writes (an assignment, an update, `delete`, the head of a for-in or for-of, a call), which looks down into its target.
// A TypeScript wrapper (as, satisfies, <T>x, x!) is what Bun's tree does not hold: here it is looked through where a
// write reference is asked for, and it stops the walk where ESLint's rule asks for the parent of a member or of a name.
// usage: node import-assign-down.cjs [--ts] [--show] <cases.json | code>...
"use strict";
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const eslintRequire = require("module").createRequire("/workspace/ref/eslint/package.json");
const { findVariable } = eslintRequire("@eslint-community/eslint-utils");
const astUtils = require("/workspace/ref/eslint/lib/rules/utils/ast-utils");
const WRAP = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSTypeAssertion", "TSNonNullExpression", "TSInstantiationExpression"]);
const OBJECT = /^(?:assign|definePropert(?:y|ies)|freeze|setPrototypeOf)$/u;
const REFLECT = /^(?:(?:define|delete)Property|set(?:PrototypeOf)?)$/u;

const proto = {
	meta: { messages: { readonly: "'{{name}}' is read-only.", readonlyMember: "The members of '{{name}}' are read-only." } },
	create(context) {
		const sourceCode = context.sourceCode;
		// What the view answers: the write references of the variables of an import statement, and the namespace ones.
		const written = new Set(), namespaces = new Map();
		let moduleScope = null;
		const unwrap = node => { while (WRAP.has(node.type)) node = node.expression; return node; };
		function direct(id, at) {
			if (written.has(id)) context.report({ node: at, messageId: "readonly", data: { name: id.name } });
		}
		function member(place, at) {
			// `place` is a member as ESLint has it in the slot: no wrapper around it.
			if (place.type !== "MemberExpression" || place.object.type !== "Identifier" || !namespaces.has(place.object)) return;
			context.report({ node: at, messageId: "readonlyMember", data: { name: place.object.name } });
		}
		function target(place, at) {
			if (!place) return;
			member(place, at);
			const node = unwrap(place);
			switch (node.type) {
				case "Identifier": direct(node, at); break;
				case "ArrayPattern": node.elements.forEach(e => target(e, at)); break;
				case "ObjectPattern": node.properties.forEach(p => target(p.type === "RestElement" ? p.argument : p.value, at)); break;
				case "RestElement": target(node.argument, at); break;
				case "AssignmentPattern": target(node.left, at); break;
			}
		}
		return {
			Program(node) {
				for (const scope of sourceCode.scopeManager.scopes) for (const variable of scope.variables) {
					if (!variable.defs.some(d => d.type === "ImportBinding" && d.parent && d.parent.type === "ImportDeclaration")) continue;
					moduleScope = scope;
					for (const ref of variable.references) {
						if (ref.isWrite()) written.add(ref.identifier);
						else if (variable.defs.some(d => d.node.type === "ImportNamespaceSpecifier")) namespaces.set(ref.identifier, variable);
					}
				}
			},
			// A declaration that initializes a name of an import (TypeScript lets the two stand in one scope): the report is at
			// the for-in or for-of statement around it, else at the name, as getWriteNode finds no other node above a declarator.
			VariableDeclaration(node) {
				let at = null;
				for (let up = node.parent; up; up = up.parent) {
					if (up.type === "ForInStatement" || up.type === "ForOfStatement") { at = up; break; }
					if (/Function|StaticBlock|TSModuleBlock/.test(up.type)) break;
				}
				(function names(pattern) {
					if (!pattern) return;
					switch (pattern.type) {
						case "Identifier": direct(pattern, at || pattern); break;
						case "ArrayPattern": pattern.elements.forEach(names); break;
						case "ObjectPattern": pattern.properties.forEach(p => names(p.type === "RestElement" ? p.argument : p.value)); break;
						case "RestElement": names(pattern.argument); break;
						case "AssignmentPattern": names(pattern.left); break;
					}
				})({ type: "ArrayPattern", elements: node.declarations.map(d => d.id) });
			},
			AssignmentExpression(node) { target(node.left, node); },
			UpdateExpression(node) { target(node.argument, node); },
			UnaryExpression(node) {
				if (node.operator !== "delete") return;
				const arg = node.argument.type === "ChainExpression" ? node.argument.expression : node.argument;
				member(arg, node);
			},
			ForInStatement(node) { if (node.left.type !== "VariableDeclaration") target(node.left, node); },
			ForOfStatement(node) { if (node.left.type !== "VariableDeclaration") target(node.left, node); },
			CallExpression(node) {
				const first = node.arguments[0];
				if (!first || first.type !== "Identifier" || !namespaces.has(first)) return;
				const callee = astUtils.skipChainExpression(node.callee);
				if (!astUtils.isSpecificMemberAccess(callee, "Object", OBJECT) && !astUtils.isSpecificMemberAccess(callee, "Reflect", REFLECT)) return;
				const variable = findVariable(moduleScope, callee.object);
				if (variable !== null && variable.scope.type === "global") context.report({ node, messageId: "readonlyMember", data: { name: first.name } });
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
	const run = rule => linter.verify(c.code, [{ files: ["**/*.js", "**/*.cjs", "**/*.ts"], plugins: { p: { rules: { proto } } }, languageOptions: { ...lo, ...(parser ? { parser } : {}) }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { [rule]: "error" } }], { filename: ts ? "a.ts" : "a.js" });
	const norm = ms => [...new Set(ms.filter(m => m.ruleId || m.fatal).map(m => (m.fatal ? "FATAL" : `${m.line}:${m.column} ${m.message}`)))].sort();
	const want = norm(run("no-import-assign")), got = norm(run("p/proto"));
	if (want[0] === "FATAL") { fatal++; continue; }
	reports += want.length;
	if (JSON.stringify(want) === JSON.stringify(got)) { equal++; if (show) console.log("same", JSON.stringify(c.code), want); }
	else { differ++; console.log("DIFFER", JSON.stringify(c.code), "\n   eslint:", want, "\n   proto: ", got); }
}
console.log(`cases ${cases.length}: same ${equal}, different ${differ}, ESLint's parser rejects ${fatal}; ${reports} reports of ESLint`);
