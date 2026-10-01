// What the four rules on `RegExp(...)` calls are planned to say before the resolution of names (D4) exists, against ESLint:
// ESLint's own rule code, with the three things that read scopes replaced by what the plan reads.
//   a name is the global when no declaration of a value with that name is anywhere in the file;
//   ReferenceTracker: the calls and `new` whose callee passes a read of `RegExp` or of `globalThis.RegExp` through
//   (logical, conditional, comma, assignment, a chain, a TypeScript node), no variable that holds it;
//   getStaticValue: nothing that names a declared variable, no array, object, call or `new` (String.raw is one).
//   no-useless-backreference: nothing is said when the flags are an identifier that the file declares.
// usage: node d3-plan.cjs [--show] <list.json>...   per list: cases, the same, and each case that differs with both answers
"use strict";
const Module = require("module");
const fs = require("fs");
const path = require("path");
const eslintDir = "/workspace/ref/eslint";
const req = Module.createRequire(path.join(eslintDir, "package.json"));
const utils = req("@eslint-community/eslint-utils");
const astUtils = req("./lib/rules/utils/ast-utils");
const real = { ReferenceTracker: utils.ReferenceTracker, getStaticValue: utils.getStaticValue, getStringIfConstant: utils.getStringIfConstant, getVariableByName: astUtils.getVariableByName };
let planned = false;

const declaredCache = new WeakMap();
function top(scope) { while (scope.upper) scope = scope.upper; return scope; }
function declared(scope) {
	const root = top(scope);
	let set = declaredCache.get(root);
	if (!set) {
		set = new Set();
		const walk = s => {
			for (const v of s.variables) if (v.defs.length > 0 && v.isValueVariable !== false) set.add(v.name);
			// A type-only import binds a name all the same for the plan: the parse pass keeps its name.
			for (const v of s.variables) if (v.defs.some(d => d.type === "ImportBinding")) set.add(v.name);
			s.childScopes.forEach(walk);
		};
		walk(root);
		declaredCache.set(root, set);
	}
	return set;
}
function children(node) {
	const out = [];
	for (const key of Object.keys(node)) {
		if (key === "parent" || key === "loc" || key === "range" || key === "tokens" || key === "comments") continue;
		const v = node[key];
		if (Array.isArray(v)) for (const x of v) { if (x && typeof x.type === "string") out.push(x); }
		else if (v && typeof v.type === "string") out.push(v);
	}
	return out;
}
const TS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSTypeAssertion", "TSNonNullExpression", "TSInstantiationExpression"]);
function passes(node, names, inner) {
	switch (node.type) {
		case "Identifier": return names.has(node.name) && inner(node);
		case "LogicalExpression": return passes(node.left, names, inner) || passes(node.right, names, inner);
		case "ConditionalExpression": return passes(node.consequent, names, inner) || passes(node.alternate, names, inner);
		case "SequenceExpression": return passes(node.expressions.at(-1), names, inner);
		case "AssignmentExpression": return passes(node.right, names, inner);
		case "ChainExpression": return passes(node.expression, names, inner);
		default: return TS.has(node.type) ? passes(node.expression, names, inner) : false;
	}
}
function tracked(callee, set) {
	const globalName = name => !set.has(name);
	const member = node => {
		switch (node.type) {
			case "MemberExpression": return node.property.type !== "PrivateIdentifier" && utils.getPropertyName(node) === "RegExp" && passes(node.object, new Set(["globalThis"]), n => globalName(n.name));
			case "LogicalExpression": return member(node.left) || member(node.right);
			case "ConditionalExpression": return member(node.consequent) || member(node.alternate);
			case "SequenceExpression": return member(node.expressions.at(-1));
			case "AssignmentExpression": return member(node.right);
			case "ChainExpression": return member(node.expression);
			default: return TS.has(node.type) ? member(node.expression) : false;
		}
	};
	return passes(callee, new Set(["RegExp"]), n => globalName(n.name)) || member(callee);
}
class PlannedTracker {
	constructor(globalScope) { this.globalScope = globalScope; }
	*iterateGlobalReferences() {
		const set = declared(this.globalScope);
		const stack = [this.globalScope.block];
		const found = [];
		while (stack.length) {
			const node = stack.pop();
			if ((node.type === "CallExpression" || node.type === "NewExpression") && tracked(node.callee, set)) found.push(node);
			stack.push(...children(node));
		}
		for (const node of found.sort((a, b) => a.range[0] - b.range[0])) yield { node, path: ["RegExp"] };
	}
}
function outside(node, scope) {
	if (!node) return false;
	const set = declared(scope);
	const stack = [node];
	while (stack.length) {
		const n = stack.pop();
		if (n.type === "Identifier" && set.has(n.name)) return true;
		if (n.type === "ArrayExpression" || n.type === "ObjectExpression" || n.type === "CallExpression" || n.type === "NewExpression") return true;
		stack.push(...children(n));
	}
	return false;
}
const patchedTracker = new Proxy(real.ReferenceTracker, { construct(target, args) { return planned ? new PlannedTracker(args[0]) : new target(...args); } });
const patch = (name, value) => Object.defineProperty(utils, name, { value, configurable: true, writable: true });
// The rules take the functions when they are loaded: they are replaced before that, and switched by `planned`.
patch("ReferenceTracker", patchedTracker);
patch("getStaticValue", (node, scope) => (planned && scope && outside(node, scope) ? null : real.getStaticValue(node, scope)));
patch("getStringIfConstant", (node, scope) => (planned && scope && outside(node, scope) ? null : real.getStringIfConstant(node, scope)));
astUtils.getVariableByName = (scope, name) => (planned ? (declared(scope).has(name) ? { defs: [1] } : null) : real.getVariableByName(scope, name));
const { SourceCode } = req("./lib/languages/js/source-code");
const realIsGlobal = SourceCode.prototype.isGlobalReference;
SourceCode.prototype.isGlobalReference = function (node) {
	if (!planned) return realIsGlobal.call(this, node);
	return node.type === "Identifier" && !declared(this.scopeManager.scopes[0]).has(node.name);
};
const { Linter } = req("./lib/linter");
const tsParser = Module.createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const names = ["no-control-regex", "no-regex-spaces", "no-useless-backreference", "no-misleading-character-class"];
const rules = Object.fromEntries(names.map(r => [r, "error"]));
// The guard of no-useless-backreference: a report on a call whose flags are a declared identifier is not made.
const guard = {
	plugins: { plan: { rules: { guard: { create(context) { return {}; } } } } },
};
function run(c, plan) {
	planned = plan;
	const o = c.languageOptions || {};
	const jsx = !!(c.jsx || (o.parserOptions && o.parserOptions.ecmaFeatures && o.parserOptions.ecmaFeatures.jsx));
	const ext = c.ext || (jsx ? "jsx" : "js");
	let messages;
	if (ext === "ts" || ext === "tsx") messages = linter.verify(c.code, [{ files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: ext === "tsx" } } }, rules }], { filename: "a." + ext });
	else for (const sourceType of c.sourceType || o.sourceType ? [c.sourceType || o.sourceType] : ["script", "module"]) {
		messages = linter.verify(c.code, [{ languageOptions: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } }, rules }], { allowInlineConfig: !plan });
		if (!messages.some(m => m.fatal)) break;
	}
	if (messages.some(m => m.fatal)) return null;
	let out = messages;
	if (plan) {
		// The flags of a call as the source has them: an identifier right before the `)` that ends the report.
		const sc = linter.getSourceCode();
		const set = declared(sc.scopeManager.scopes[0]);
		out = messages.filter(m => {
			if (m.ruleId !== "no-useless-backreference") return true;
			const node = sc.getNodeByRangeIndex(sc.getIndexFromLoc({ line: m.line, column: m.column - 1 }));
			let call = node;
			while (call && !((call.type === "CallExpression" || call.type === "NewExpression") && call.loc.start.line === m.line && call.loc.start.column === m.column - 1 && call.loc.end.line === m.endLine && call.loc.end.column === m.endColumn - 1)) call = call.parent;
			const flags = call && call.arguments[1];
			return !(flags && flags.type === "Identifier" && set.has(flags.name));
		});
	}
	return out.map(m => `${m.ruleId} ${m.line}:${m.column} ${m.message}`).sort();
}
const show = process.argv.includes("--show");
const esc = s => JSON.stringify(s).replace(/[\u0080-\uffff]/g, ch => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
for (const file of process.argv.slice(2).filter(a => a.endsWith(".json"))) {
	const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
	const list = (Array.isArray(parsed) ? parsed : [...parsed.valid, ...parsed.invalid]).map(c => (typeof c === "string" ? { code: c } : c));
	let same = 0, skipped = 0;
	const differ = [];
	for (const c of list) {
		if (c.languageOptions && c.languageOptions.globals) { skipped++; continue; }
		const theirs = run(c, false);
		if (!theirs) { skipped++; continue; }
		const ours = run(c, true);
		if (JSON.stringify(theirs) === JSON.stringify(ours)) { same++; continue; }
		const missing = theirs.filter(r => !ours.includes(r)), extra = ours.filter(r => !theirs.includes(r));
		differ.push({ code: c.code, missing, extra });
	}
	console.log(`${path.basename(file)}: ${list.length} cases, ${skipped} not compared, ${same} the same, ${differ.length} differ`);
	for (const d of differ) {
		const rulesOf = l => [...new Set(l.map(r => r.split(" ")[0].replace("no-", "")))].join(",");
		console.log(`  ${d.missing.length ? "missing " + rulesOf(d.missing) : ""}${d.missing.length && d.extra.length ? "; " : ""}${d.extra.length ? "extra " + rulesOf(d.extra) : ""}: ${esc(d.code)}`);
		if (show) { for (const r of d.missing) console.log("      - " + esc(r)); for (const r of d.extra) console.log("      + " + esc(r)); }
	}
}
