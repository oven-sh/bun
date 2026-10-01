// Research scratch of "rule-no-unused-vars": the rule as it is to be written on the view of name resolution, run in
// JavaScript on eslint-scope's own scopes, and compared with ESLint's rule at the pin.
// It reads of a reference only what the plan gives a reference: its number in creation order (`seq`), read/write, the
// scope it is from, what it resolved to, and the site facts that ONE top-down walk with three context values sets
// (no parent pointer is followed): assign target, logical operator, update operand, unused value, in a loop,
// the for-in/of exception, and where the references of the right side end. Of a function: whether it is a setter, and
// the number of references that existed when the node that decides "storable" was entered.
// usage: node nuv-sim.cjs [--type script|module|commonjs] [--show N] [--source-order] <file.js | cases.json | --code "..." | --list files.txt>...
//   --source-order: the experiment that numbers the references by where they stand instead of by when the Referencer made them.
//   a .json is [{code, ext?, sourceType?}] or ["code"]; every case runs as each source type that parses unless --type.
"use strict";
const fs = require("fs");
const path = require("path");
const escope = require("/workspace/ref/eslint/node_modules/eslint-scope");
const evk = require("/workspace/ref/eslint/node_modules/eslint-visitor-keys");
const { Linter } = require("/workspace/ref/eslint/lib/linter");

// ---- instrumentation: what a faithful port of the Referencer knows while it runs ----
let seqCounter = 0;
let entered = new WeakMap(), exited = new WeakMap();
const origReferencing = escope.Scope.prototype.__referencing;
escope.Scope.prototype.__referencing = function (...a) {
	const before = this.references.length;
	origReferencing.apply(this, a);
	if (this.references.length > before) this.references.at(-1).seq = seqCounter++;
};
const R = escope.Referencer.prototype;
const origVisit = R.visit, origVisitChildren = R.visitChildren;
R.visit = function (node) {
	if (node && typeof node === "object" && !entered.has(node)) entered.set(node, seqCounter);
	origVisit.call(this, node);
	if (node && typeof node === "object") exited.set(node, seqCounter);
};
R.visitChildren = function (node) {
	if (node && typeof node === "object" && !entered.has(node)) entered.set(node, seqCounter);
	origVisitChildren.call(this, node);
};

const isFn = n => n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression";
const isLoop = n => /^(?:DoWhile|For|ForIn|ForOf|While)Statement$/.test(n.type);
const LOGICAL = new Set(["&&=", "||=", "??="]);

// ---- the one top-down walk: site facts by identifier node, facts by function node ----
function collectFacts(ast, visitorKeys) {
	const site = new Map(); // Identifier node -> {assign, logical, update, unused, inLoop, forReturn, rhsEnd}
	const fnFacts = new Map(); // function node -> {storableAt: number|null, setter: bool}
	const get = id => { let s = site.get(id); if (!s) site.set(id, (s = {})); return s; };
	const forReturn = body => {
		const first = body.type === "BlockStatement" ? body.body[0] : body;
		return !!first && first.type === "ReturnStatement";
	};
	function walk(node, cx, parent, key) {
		if (!node || typeof node.type !== "string") return;
		if (node.type === "Identifier" || node.type === "JSXIdentifier") {
			const s = get(node);
			s.inLoop = cx.loop > 0;
			return;
		}
		let loop = cx.loop;
		if (isLoop(node)) loop += 1;
		if (isFn(node)) {
			fnFacts.set(node, { storableAt: cx.fn.verdict ? cx.fn.at : null, setter: !!parent && (parent.type === "Property" || parent.type === "MethodDefinition") && parent.kind === "set" });
			loop = 0;
		}
		if (node.type === "AssignmentExpression" && node.left.type === "Identifier") {
			const s = get(node.left);
			s.assign = true;
			s.logical = LOGICAL.has(node.operator);
			s.unused = cx.unused;
			s.rhsEnd = exited.get(node.right);
		}
		if (node.type === "UpdateExpression" && node.argument.type === "Identifier") {
			const s = get(node.argument);
			s.update = true;
			s.unused = cx.unused;
		}
		if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
			if (forReturn(node.body)) {
				if (node.left.type === "Identifier") get(node.left).forReturn = true;
				if (node.left.type === "VariableDeclaration" && node.left.declarations[0].id.type === "Identifier") get(node.left.declarations[0].id).forReturn = true;
				// The declarator's init, for the `for (var x = y in z)` of sloppy code, and the right side.
				if (node.left.type === "VariableDeclaration" && node.left.declarations[0].init && node.left.declarations[0].init.type === "Identifier") get(node.left.declarations[0].init).forReturn = true;
				if (node.right.type === "Identifier") get(node.right).forReturn = true;
			}
		}
		const keys = visitorKeys[node.type] || evk.getKeys(node);
		for (const k of keys) {
			const child = node[k];
			const each = (c, i, list) => {
				if (!c || typeof c.type !== "string") return;
				// unused value
				let unused = false;
				if (node.type === "ExpressionStatement" && k === "expression") unused = true;
				else if (node.type === "SequenceExpression") unused = i !== list.length - 1 ? true : cx.unused;
				// storable
				let fn;
				if (node.type === "SequenceExpression") fn = i === list.length - 1 ? cx.fn : { verdict: false };
				else if (node.type === "CallExpression" || node.type === "NewExpression") fn = k === "callee" ? { verdict: false } : { verdict: true, at: entered.get(node) };
				else if (node.type === "AssignmentExpression" || node.type === "TaggedTemplateExpression" || node.type === "YieldExpression") fn = { verdict: true, at: entered.get(node) };
				else if (/(?:Statement|Declaration)$/.test(node.type)) fn = { verdict: true, at: entered.get(node) };
				else fn = cx.fn;
				walk(c, { unused, loop, fn }, node, k);
			};
			if (Array.isArray(child)) child.forEach((c, i) => each(c, i, child));
			else each(child, 0, [child]);
		}
	}
	walk(ast, { unused: false, loop: 0, fn: { verdict: false } }, null, null);
	return { site, fnFacts };
}

// ---- the rule on those facts ----
function unusedVars(scopeManager, ast, facts) {
	const { site, fnFacts } = facts;
	const S = ref => site.get(ref.identifier) || {};
	const nearestFunction = scope => {
		for (let s = scope; s; s = s.upper) if (s.type === "function" && isFn(s.block)) return s.block;
		return null;
	};
	const isInside = (ref, rhs) => ref.seq > rhs.of && ref.seq < rhs.end;
	const insideStorable = (ref, rhs) => {
		const f = nearestFunction(ref.from);
		if (!f) return false;
		const at = fnFacts.get(f).storableAt;
		return at !== null && at > rhs.of;
	};
	const readForItself = (ref, rhs) => {
		const s = S(ref);
		return ref.isRead() && ((s.assign && s.unused && !s.logical) || (s.update && s.unused) || (!!rhs && isInside(ref, rhs) && !insideStorable(ref, rhs)));
	};
	const rhsNode = (ref, prev, variable) => {
		const s = S(ref);
		const later = ref.from.variableScope !== variable.scope.variableScope || s.inLoop;
		if (prev && isInside(ref, prev)) return prev;
		if (s.assign && s.unused && !later) return { of: ref.seq, end: s.rhsEnd };
		return null;
	};
	const fnBlocks = variable => {
		const out = [];
		for (const def of variable.defs) {
			if (def.type === "FunctionName") out.push(def.node);
			if (def.type === "Variable" && def.node.init && (def.node.init.type === "FunctionExpression" || def.node.init.type === "ArrowFunctionExpression")) out.push(def.node.init);
		}
		return out;
	};
	const selfRef = (ref, nodes) => {
		for (let s = ref.from; s; s = s.upper) if (nodes.includes(s.block)) return true;
		return false;
	};
	const isUsed = variable => {
		const nodes = fnBlocks(variable);
		let rhs = null;
		for (const ref of variable.references) {
			if (S(ref).forReturn) return true;
			const forItself = readForItself(ref, rhs);
			rhs = rhsNode(ref, rhs, variable);
			if (ref.isRead() && !forItself && !(nodes.length > 0 && selfRef(ref, nodes))) return true;
		}
		return false;
	};
	const isExported = variable => {
		const def = variable.defs[0];
		let node = def.node;
		if (node.type === "VariableDeclarator") node = node.parent;
		else if (def.type === "Parameter") return false;
		return node.parent.type.startsWith("Export");
	};
	const afterLastUsed = variable => {
		const vars = variable.scope.variables;
		for (let i = vars.indexOf(variable) + 1; i < vars.length; i++) if (vars[i].defs.some(d => d.type === "Parameter") && vars[i].references.length > 0) return false;
		return true;
	};
	const out = [];
	for (const scope of scopeManager.scopes) {
		if (scope.functionExpressionScope) continue;
		for (const variable of scope.variables) {
			const def = variable.defs[0];
			if (!def) continue;
			if (scope.type === "class" && def.type === "ClassName") continue;
			if (def.type === "Parameter") {
				if (fnFacts.get(def.node) && fnFacts.get(def.node).setter) continue;
				// A plain identifier in the parameter list: no default, no pattern, no rest.
				if (def.node.params.includes(def.name) && !afterLastUsed(variable)) continue;
			}
			if (isUsed(variable) || isExported(variable)) continue;
			const writes = variable.references.filter(r => r.isWrite() && r.from.variableScope === variable.scope.variableScope);
			const at = writes.length ? writes.at(-1).identifier : variable.identifiers[0];
			const action = variable.references.some(r => r.isWrite()) ? "assigned a value" : "defined";
			out.push(`${at.loc.start.line}:${at.loc.start.column + 1} '${variable.name}' is ${action} but never used.`);
		}
	}
	return out;
}

// ---- the comparison ----
const linter = new Linter({ configType: "flat" });
let current = null;
const simRule = {
	create(context) {
		return { "Program:exit"(ast) {
			const sm = context.sourceCode.scopeManager;
			if (SOURCE_ORDER) {
				// The experiment: references numbered by where they stand, and the two ticks of a node counted from its range.
				const all = [];
				for (const scope of sm.scopes) for (const ref of scope.references) all.push(ref);
				all.sort((a, b) => a.identifier.range[0] - b.identifier.range[0] || a.seq - b.seq);
				all.forEach((ref, i) => (ref.seq = i));
				const starts = all.map(r => r.identifier.range[0]);
				const before = pos => { let lo = 0, hi = starts.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (starts[mid] < pos) lo = mid + 1; else hi = mid; } return lo; };
				entered = { get: n => before(n.range[0]) };
				exited = { get: n => before(n.range[1]) };
				for (const scope of sm.scopes) for (const v of scope.variables) v.references.sort((a, b) => a.seq - b.seq);
			}
			current = unusedVars(sm, ast, collectFacts(ast, context.sourceCode.visitorKeys));
		} };
	},
};
function run(code, sourceType, jsx) {
	seqCounter = 0;
	entered = new WeakMap();
	exited = new WeakMap();
	current = null;
	const config = [{ files: ["**/*.{js,jsx,mjs,cjs}"], languageOptions: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } }, plugins: { sim: { rules: { nuv: simRule } } }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { "no-unused-vars": "error", "sim/nuv": "error" } }];
	let messages;
	try { messages = linter.verify(code, config, { filename: sourceType === "commonjs" ? "c.cjs" : jsx ? "c.jsx" : "c.js" }); } catch (e) { return { crash: String(e && e.stack || e).slice(0, 600) }; }
	if (messages.some(m => m.fatal)) return null;
	if (messages.some(m => m.ruleId === "sim/nuv")) return { crash: JSON.stringify(messages.filter(m => m.ruleId === "sim/nuv").slice(0, 2)) };
	const theirs = messages.filter(m => m.ruleId === "no-unused-vars").map(m => `${m.line}:${m.column} ${m.message}`).sort();
	return { theirs, ours: (current || []).slice().sort() };
}
const args = process.argv.slice(2);
let only = null, show = 20;
var SOURCE_ORDER = false;
const inputs = [];
while (args.length) {
	const a = args.shift();
	if (a === "--type") only = args.shift();
	else if (a === "--show") show = Number(args.shift());
	else if (a === "--source-order") SOURCE_ORDER = true;
	else if (a === "--code") inputs.push({ code: args.shift(), from: "(arg)" });
	else if (a === "--list") for (const f of fs.readFileSync(args.shift(), "utf8").split("\n").filter(Boolean)) inputs.push({ file: f });
	else if (a.endsWith(".json")) for (const c of JSON.parse(fs.readFileSync(a, "utf8"))) inputs.push(typeof c === "string" ? { code: c, from: a } : { code: c.code, ext: c.ext, sourceType: c.sourceType, jsx: c.jsx, from: a });
	else inputs.push({ file: a });
}
const tally = { inputs: 0, runs: 0, same: 0, different: 0, rejected: 0, crashed: 0, reports: 0 };
let shown = 0;
for (const input of inputs) {
	tally.inputs += 1;
	let code = input.code;
	let ext = input.ext || (input.jsx ? "jsx" : "js");
	if (input.file) {
		try { code = fs.readFileSync(input.file, "utf8").replace(/^\uFEFF/, ""); } catch { continue; }
		ext = path.extname(input.file).slice(1);
	}
	if (!["js", "jsx", "mjs", "cjs"].includes(ext)) continue;
	const types = only ? [only] : input.sourceType ? [input.sourceType] : ext === "mjs" ? ["module"] : ext === "cjs" ? ["commonjs"] : ["script", "module", "commonjs"];
	let any = false;
	for (const type of types) {
		let r = run(code, type, ext === "jsx");
		if (r === null && ext === "js") r = run(code, type, true);
		if (r === null) continue;
		any = true;
		tally.runs += 1;
		if (r.crash) { tally.crashed += 1; if (shown++ < show) console.log(`CRASH ${input.file || JSON.stringify(code).slice(0, 200)} [${type}]\n  ${r.crash}`); continue; }
		tally.reports += r.theirs.length;
		if (JSON.stringify(r.theirs) === JSON.stringify(r.ours)) tally.same += 1;
		else {
			tally.different += 1;
			if (shown++ < show) console.log(`DIFFERENT ${input.file || JSON.stringify(code).slice(0, 300)} [${type}]\n  only eslint: ${r.theirs.filter(x => !r.ours.includes(x)).slice(0, 8).join(" | ") || "-"}\n  only sim:    ${r.ours.filter(x => !r.theirs.includes(x)).slice(0, 8).join(" | ") || "-"}`);
		}
	}
	if (!any) tally.rejected += 1;
}
console.log(JSON.stringify(tally));
