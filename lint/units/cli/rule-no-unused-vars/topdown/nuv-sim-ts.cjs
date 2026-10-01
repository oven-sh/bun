// Research scratch of "rule-no-unused-vars": the TypeScript side of the rule as it is to be written on the view of name
// resolution, run in JavaScript on the scopes of typescript-eslint, and compared with @typescript-eslint/no-unused-vars
// at the pin. The marks that typescript-eslint sets with a second AST visitor and with selectors are restated here as
// facts of a definition, of a scope and of a reference (M1 to M11 of the findings); a reference gives its number in
// creation order, read/write, its scope, its variable, and the site facts of one top-down walk.
// usage: node nuv-sim-ts.cjs [--show N] [--unbuilt] <file.ts | cases.json | --code "..." | --list files.txt>...   (a .json: ["code"] or [{code, ext}])
//   --unbuilt: the experiment of the fallback for what the parser does not build (the members and heritage of an interface, the type of
//   an alias, a class index signature): no reference and no variable inside, every identifier token there a read by name. `extra` has to stay 0.
//   --token-marks: the experiment that reads the names under the parameters of a setter or of a signature from the tokens of the parameter list.
"use strict";
const fs = require("fs");
const path = require("path");
const TSE = "/workspace/ref/tseslint/node_modules/@typescript-eslint";
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const tsPlugin = req("@typescript-eslint/eslint-plugin");
const { VisitorBase } = require(`${TSE}/scope-manager/dist/referencer/VisitorBase.js`);
const { ScopeBase } = require(`${TSE}/scope-manager/dist/scope/ScopeBase.js`);
const { visitorKeys } = require("module").createRequire(`${TSE}/scope-manager/`)("@typescript-eslint/visitor-keys");

let seqCounter = 0, analysing = false;
let entered = new WeakMap(), exited = new WeakMap();
for (const m of ["referenceValue", "referenceType", "referenceDualValueType"]) {
	const orig = ScopeBase.prototype[m];
	ScopeBase.prototype[m] = function (...a) {
		const before = this.references.length;
		orig.apply(this, a);
		if (this.references.length > before) this.references.at(-1).seq = seqCounter++;
	};
}
const origVisit = VisitorBase.prototype.visit, origVisitChildren = VisitorBase.prototype.visitChildren;
VisitorBase.prototype.visit = function (node) {
	const track = analysing && node && typeof node === "object";
	if (track && !entered.has(node)) entered.set(node, seqCounter);
	origVisit.call(this, node);
	if (track && !exited.has(node)) exited.set(node, seqCounter);
};
VisitorBase.prototype.visitChildren = function (node, ex) {
	if (analysing && node && typeof node === "object" && !entered.has(node)) entered.set(node, seqCounter);
	origVisitChildren.call(this, node, ex);
};
// The analysis runs inside parseForESLint: the flag is on from the start of a verify to the first rule listener.
const isFn = n => n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression";
const isLoop = n => /^(?:DoWhile|For|ForIn|ForOf|While)Statement$/.test(n.type);
const LOGICAL = new Set(["&&=", "||=", "??="]);
const SIGNATURES = new Set(["TSCallSignatureDeclaration", "TSConstructorType", "TSConstructSignatureDeclaration", "TSDeclareFunction", "TSEmptyBodyFunctionExpression", "TSFunctionType", "TSMethodSignature"]);
const AMBIENT_KINDS = new Set(["TSInterfaceDeclaration", "TSTypeAliasDeclaration", "ClassDeclaration", "TSDeclareFunction", "TSEnumDeclaration", "TSModuleDeclaration", "VariableDeclaration"]);

function collectFacts(ast) {
	const site = new Map();
	const fnFacts = new Map();
	const forMarks = []; // {decl: VariableDeclaration} | {id: Identifier}
	const globals = []; // TSModuleDeclaration of kind global
	const paramLists = []; // the parameters of a setter and of a signature without a body: every identifier in them marks a name
	const unbuilt = []; // {node, from, to}: what the parser reads and does not build (X4.3, X4.4)
	const get = id => { let s = site.get(id); if (!s) site.set(id, (s = {})); return s; };
	function walk(node, cx, parent, key) {
		if (!node || typeof node.type !== "string") return;
		if (node.type === "Identifier" || node.type === "JSXIdentifier") get(node).inLoop = cx.loop > 0;
		let loop = cx.loop;
		if (isLoop(node)) loop += 1;
		if (isFn(node)) { fnFacts.set(node, { storableAt: cx.fn.verdict ? cx.fn.at : null }); loop = 0; }
		if (node.type === "AssignmentExpression" && node.left.type === "Identifier") Object.assign(get(node.left), { assign: true, logical: LOGICAL.has(node.operator), unused: cx.unused, rhsEnd: exited.get(node.right) });
		if (node.type === "UpdateExpression" && node.argument.type === "Identifier") Object.assign(get(node.argument), { update: true, unused: cx.unused });
		if (node.type === "TSTypeQuery") { let e = node.exprName; while (e.type === "TSQualifiedName") e = e.left; if (e.type === "Identifier") get(e).typeQuery = true; }
		if (node.type === "TSTypePredicate" && node.parameterName.type === "Identifier") get(node.parameterName).typePredicate = true;
		if (node.type === "TSModuleDeclaration" && node.kind === "global") globals.push(node);
		if (UNBUILT) {
			if (node.type === "TSInterfaceDeclaration") unbuilt.push({ node, from: (node.typeParameters || node.id).range[1], to: node.range[1] });
			if (node.type === "TSTypeAliasDeclaration") unbuilt.push({ node, from: node.typeAnnotation.range[0], to: node.range[1] });
			if (node.type === "TSIndexSignature" && parent && parent.type === "ClassBody") unbuilt.push({ node, from: node.range[0], to: node.range[1] });
		}
		if (SIGNATURES.has(node.type)) paramLists.push(node.params);
		if ((node.type === "MethodDefinition" || node.type === "Property") && node.kind === "set" && node.value && node.value.params) paramLists.push(node.value.params);
		if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
			let body = node.body, ok = true;
			if (body.type === "BlockStatement") { if (body.body.length !== 1) ok = false; else body = body.body[0]; }
			if (ok && body.type === "ReturnStatement") {
				if (node.left.type === "VariableDeclaration") forMarks.push({ decl: node.left });
				else if (node.left.type === "Identifier") forMarks.push({ id: node.left });
			}
		}
		for (const k of visitorKeys[node.type] || []) {
			const child = node[k];
			const each = (c, i, list) => {
				if (!c || typeof c.type !== "string") return;
				let unused = false;
				if (node.type === "ExpressionStatement" && k === "expression") unused = true;
				else if (node.type === "SequenceExpression") unused = i !== list.length - 1 ? true : cx.unused;
				let fn;
				if (node.type === "SequenceExpression") fn = i === list.length - 1 ? cx.fn : { verdict: false };
				else if (node.type === "CallExpression" || node.type === "NewExpression") fn = k === "callee" ? { verdict: false } : { verdict: true, at: entered.get(node) };
				else if (node.type === "AssignmentExpression" || node.type === "TaggedTemplateExpression" || node.type === "YieldExpression") fn = { verdict: true, at: entered.get(node) };
				else if (node.type.endsWith("Statement") || node.type.endsWith("Declaration")) fn = { verdict: true, at: entered.get(node) };
				else fn = cx.fn;
				walk(c, { unused, loop, fn }, node, k);
			};
			if (Array.isArray(child)) child.forEach((c, i) => each(c, i, child));
			else each(child, 0, [child]);
		}
	}
	walk(ast, { unused: false, loop: 0, fn: { verdict: false } }, null, null);
	return { site, fnFacts, forMarks, globals, paramLists, unbuilt };
}

const overriding = body => body.some(s => (s.type === "ExportNamedDeclaration" && s.declaration == null) || s.type === "ExportAllDeclaration" || s.type === "TSExportAssignment" || (s.type === "ExportDefaultDeclaration" && s.declaration.type === "Identifier"));
const isDts = f => /\.d\.(ts|cts|mts|.*\.ts)$/.test(f.toLowerCase());

function unusedVars(scopeManager, ast, facts, filename, tokens) {
	const { site, fnFacts, forMarks, globals, paramLists, unbuilt } = facts;
	// The experiment of the fallback: inside what is not built, no reference and no variable exists, and every identifier token is a read by name.
	unbuilt.sort((a, b) => a.from - b.from);
	const inUnbuilt = pos => unbuilt.some(u => pos >= u.from && pos < u.to);
	const textUsed = new Set();
	const S = ref => site.get(ref.identifier) || {};
	const marked = new Set();
	const lookup = (scope, name) => { for (let s = scope; s; s = s.upper) { const v = s.variables.find(x => x.name === name); if (v) return v; } return null; };
	const scopeOf = node => { for (let n = node; n; n = n.parent) { const s = scopeManager.acquire(n, n.type !== "Program"); if (s) return s.type === "functionExpressionName" ? s.childScopes[0] : s; } return scopeManager.scopes[0]; };
	// The ambient container of a declaration: what the four selectors of the rule ask.
	const ambient = decl => {
		if (!AMBIENT_KINDS.has(decl.type)) return false;
		const p = decl.parent;
		if (p.type === "Program") return isDts(filename) && !overriding(p.body);
		if (p.type !== "TSModuleBlock") return false;
		let declared = isDts(filename);
		for (let m = p.parent; m && !declared; m = m.parent) if (m.type === "TSModuleDeclaration" && m.declare === true) declared = true;
		return declared && !overriding(p.body);
	};
	for (const scope of scopeManager.scopes) {
		if (scope.type === "class") { const v = scope.variables.find(x => x.identifiers[0] === scope.block.id); if (v) marked.add(v); } // M1
		if (scope.type === "function" && (scope.block.type === "FunctionDeclaration" || scope.block.type === "FunctionExpression")) { const v = scope.set.get("arguments"); if (v && v.defs.length === 0) marked.add(v); } // M2
		if (scope.type === "tsEnum") for (const v of scope.variables) marked.add(v); // M6
		if (scope.type === "mappedType") { const v = lookup(scope, scope.block.key.name); if (v) marked.add(v); } // M7
		for (const v of scope.variables) {
			for (const def of v.defs) {
				if (def.type === "Parameter") {
					const f = def.node;
					if (v.name === "this" && scope.type === "function" && f.params.includes(def.name)) marked.add(v); // M5
					let p = def.name.parent;
					if (p.type === "AssignmentPattern" && p.left === def.name) p = p.parent;
					if (p.type === "TSParameterProperty") marked.add(v); // M9
				} else {
					const decl = def.node.type === "VariableDeclarator" ? def.node.parent : def.node;
					if (ambient(decl)) marked.add(v); // M11
				}
			}
		}
	}
	// M3 and M4: every Identifier node under a parameter of a setter or of a signature, looked up by its name from where it stands.
	const idsUnder = (node, out) => { if (!node || typeof node.type !== "string") return out; if (node.type === "Identifier") out.push(node); for (const k of visitorKeys[node.type] || []) { const c = node[k]; if (Array.isArray(c)) c.forEach(x => idsUnder(x, out)); else idsUnder(c, out); } return out; };
	if (!TOKEN_MARKS) for (const params of paramLists) for (const param of params) for (const id of idsUnder(param, [])) { const v = lookup(scopeOf(id), id.name); if (v) marked.add(v); }
	// The experiment: the names are read from the tokens of the parameter list, and looked up from the scope of the signature.
	else for (const params of paramLists) if (params.length) {
		const from = params[0].range[0], to = params.at(-1).range[1];
		const start = scopeOf(params[0]);
		for (const token of tokens) if (token.range[0] >= from && token.range[1] <= to && token.type === "Identifier") { const v = lookup(start, token.value); if (v) marked.add(v); }
		// A name that is declared inside the list (a parameter or a type parameter of a type in it, an `infer`, the key of a mapped type) is found from where it stands: it is marked itself.
		for (const scope of scopeManager.scopes) for (const v of scope.variables) if (v.defs.some(d => d.name.range[0] >= from && d.name.range[1] <= to)) marked.add(v);
	}
	for (const g of globals) { const v = lookup(scopeOf(g.parent), "global"); if (v) marked.add(v); } // M8
	for (const m of forMarks) { // M10
		if (m.decl) { const v = scopeManager.getDeclaredVariables(m.decl)[0]; if (v) marked.add(v); }
		else { const v = lookup(scopeOf(m.id), m.id.name); if (v) marked.add(v); }
	}
	const nearestFunction = scope => { for (let s = scope; s; s = s.upper) if (s.type === "function" && isFn(s.block)) return s.block; return null; };
	// The reference that the scope manager makes for the JSX pragma has the declaration of the name as its identifier: it is inside no right side.
	const pseudo = ref => ref.isRead() && !ref.isWrite() && !!ref.resolved && ref.resolved.identifiers.includes(ref.identifier);
	const isInside = (ref, rhs) => ref.seq > rhs.of && ref.seq < rhs.end && !pseudo(ref);
	const insideStorable = (ref, rhs) => { const f = nearestFunction(ref.from); if (!f) return false; const at = fnFacts.get(f).storableAt; return at !== null && at > rhs.of; };
	const readForItself = (ref, rhs) => { const s = S(ref); return ref.isRead() && ((s.assign && s.unused && !s.logical) || (s.update && s.unused) || (!!rhs && isInside(ref, rhs) && !insideStorable(ref, rhs))); };
	const rhsNode = (ref, prev, variable) => { const s = S(ref); const later = ref.from.variableScope !== variable.scope.variableScope || s.inLoop; if (prev && isInside(ref, prev)) return prev; if (s.assign && s.unused && !later) return { of: ref.seq, end: s.rhsEnd }; return null; };
	const selfRef = (ref, nodes) => { for (let s = ref.from; s; s = s.upper) if (nodes.has(s.block)) return true; return false; };
	const typeImport = d => d.type === "ImportBinding" && (d.parent.importKind === "type" || (d.node.type === "ImportSpecifier" && d.node.importKind === "type"));
	const asType = ref => !!(S(ref).typeQuery || S(ref).typePredicate);
	const isUsed = variable => {
		const fns = new Set(), types = [], mods = new Set(), enums = new Set();
		for (const def of variable.defs) {
			if (def.type === "FunctionName") fns.add(def.node);
			if (def.type === "Variable" && def.node.init && (def.node.init.type === "FunctionExpression" || def.node.init.type === "ArrowFunctionExpression")) fns.add(def.node.init);
			if (def.node.type === "TSInterfaceDeclaration" || def.node.type === "TSTypeAliasDeclaration") types.push(def.node);
			if (def.node.type === "TSModuleDeclaration") mods.add(def.node);
			if (def.node.type === "TSEnumDeclaration") enums.add(def.node);
		}
		const importedAsType = variable.defs.every(typeImport);
		let rhs = null;
		for (const ref of refsOf(variable)) {
			const forItself = readForItself(ref, rhs);
			rhs = rhsNode(ref, rhs, variable);
			if (ref.isRead() && !forItself && !(!importedAsType && asType(ref)) && !(fns.size && selfRef(ref, fns)) && !(types.length && types.some(t => ref.identifier.range[0] >= t.range[0] && ref.identifier.range[1] <= t.range[1])) && !(mods.size && selfRef(ref, mods)) && !(enums.size && selfRef(ref, enums))) return true;
		}
		return false;
	};
	const isExported = variable => variable.defs.some(def => { let node = def.node; if (node.type === "VariableDeclarator") node = node.parent; else if (def.type === "Parameter") return false; return node.parent.type.startsWith("Export"); });
	const afterLastUsed = variable => { const vars = variable.scope.variables; for (let i = vars.indexOf(variable) + 1; i < vars.length; i++) if (vars[i].defs.some(d => d.type === "Parameter") && (refsOf(vars[i]).length > 0 || marked.has(vars[i]))) return false; return true; };
	if (unbuilt.length) {
		for (const u of unbuilt) {
			// The scope that the declaration stands in, or its own scope of type parameters: where a reference from it would start.
			let from = null;
			for (let n = u.node; n && !from; n = n.parent) { from = scopeManager.acquire(n, true); if (from && from.type === "functionExpressionName") from = from.childScopes[0]; }
			from = from || scopeManager.scopes[0];
			for (const token of tokens) if (token.range[0] >= u.from && token.range[1] <= u.to && token.type === "Identifier") {
				// What a token stands for is not known: it is a read of the nearest variable of that name that is a type, and of the nearest that is a value.
				for (const kind of ["isTypeVariable", "isValueVariable"]) for (let sc = from; sc; sc = sc.upper) { const v = sc.variables.find(x => x.name === token.value && x[kind]); if (v) { textUsed.add(v); break; } }
			}
		}
	}
	// The references of a variable that the view has: not those inside what is not built. The scopes are shared with the real rule: nothing is changed in them.
	const refsOf = v => (unbuilt.length ? v.references.filter(r => !inUnbuilt(r.identifier.range[0])) : v.references);
	const out = [];
	for (const scope of scopeManager.scopes) {
		if (scope.functionExpressionScope) continue;
		for (const variable of scope.variables) {
			const def = variable.defs[0];
			if (!def) continue;
			if (unbuilt.length && (textUsed.has(variable) || inUnbuilt(def.name.range[0]))) continue;
			if (def.type === "Parameter" && isFn(def.name.parent) && !afterLastUsed(variable)) continue;
			if (marked.has(variable)) continue;
			if (isExported(variable) || isUsed(variable)) continue;
			const onlyAsType = refsOf(variable).some(asType);
			if (onlyAsType && variable.defs.some(d => d.type === "ImportBinding")) continue;
			const writes = refsOf(variable).filter(r => r.isWrite() && r.from.variableScope === variable.scope.variableScope);
			const at = writes.length ? writes.at(-1).identifier : variable.identifiers[0];
			const action = refsOf(variable).some(r => r.isWrite()) ? "assigned a value" : "defined";
			out.push(`${at.loc.start.line}:${at.loc.start.column + 1} '${variable.name}' is ${action} but ${onlyAsType ? "only used as a type" : "never used"}.`);
		}
	}
	return out;
}

const linter = new Linter({ configType: "flat" });
let current = null;
const simRule = { create(context) { analysing = false; return { "Program:exit"(ast) { current = unusedVars(context.sourceCode.scopeManager, ast, collectFacts(ast), context.filename, context.sourceCode.ast.tokens); } }; } };
function run(code, ext) {
	seqCounter = 0; entered = new WeakMap(); exited = new WeakMap(); current = null; analysing = true;
	const sourceType = ext === "cts" ? "commonjs" : "module";
	const config = [{ files: ["**/*.{ts,tsx,mts,cts}"], languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType }, plugins: { "@typescript-eslint": tsPlugin, sim: { rules: { nuv: simRule } } }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { "sim/nuv": "error", "@typescript-eslint/no-unused-vars": "error" } }];
	let messages;
	try { messages = linter.verify(code, config, { filename: `c.${ext}` }); } catch (e) { return { crash: String((e && e.stack) || e).slice(0, 700) }; }
	if (messages.some(m => m.fatal)) return null;
	if (messages.some(m => m.ruleId === "sim/nuv")) return { crash: JSON.stringify(messages.filter(m => m.ruleId === "sim/nuv").slice(0, 2)) };
	const theirs = messages.filter(m => m.ruleId === "@typescript-eslint/no-unused-vars").map(m => `${m.line}:${m.column} ${m.message}`).sort();
	return { theirs, ours: (current || []).slice().sort() };
}
const args = process.argv.slice(2);
let show = 20, forceExt = null;
var UNBUILT = false, TOKEN_MARKS = false;
const inputs = [];
while (args.length) {
	const a = args.shift();
	if (a === "--show") show = Number(args.shift());
	else if (a === "--ext") forceExt = args.shift();
	else if (a === "--unbuilt") UNBUILT = true;
	else if (a === "--token-marks") TOKEN_MARKS = true;
	else if (a === "--code") inputs.push({ code: args.shift() });
	else if (a === "--list") for (const f of fs.readFileSync(args.shift(), "utf8").split("\n").filter(Boolean)) inputs.push({ file: f });
	else if (a.endsWith(".json")) for (const c of JSON.parse(fs.readFileSync(a, "utf8"))) inputs.push(typeof c === "string" ? { code: c } : { code: c.code, ext: c.ext });
	else inputs.push({ file: a });
}
const tally = { inputs: 0, same: 0, different: 0, rejected: 0, crashed: 0, reports: 0, extra: 0, missing: 0 };
let shown = 0;
for (const input of inputs) {
	let code = input.code, ext = forceExt || input.ext || "ts";
	if (input.file) {
		try { code = fs.readFileSync(input.file, "utf8").replace(/^\uFEFF/, ""); } catch { continue; }
		const m = /\.(d\.ts|d\.mts|d\.cts|tsx|mts|cts|ts)$/.exec(input.file);
		if (!m) continue;
		ext = forceExt || m[1];
	}
	tally.inputs += 1;
	const r = run(code, ext);
	if (r === null) { tally.rejected += 1; continue; }
	if (r.crash) { tally.crashed += 1; if (shown++ < show) console.log(`CRASH ${input.file || JSON.stringify(code).slice(0, 200)}\n  ${r.crash}`); continue; }
	tally.reports += r.theirs.length;
	if (JSON.stringify(r.theirs) === JSON.stringify(r.ours)) tally.same += 1;
	else {
		tally.different += 1;
		tally.extra += r.ours.filter(x => !r.theirs.includes(x)).length;
		tally.missing += r.theirs.filter(x => !r.ours.includes(x)).length;
		if (shown++ < show) console.log(`DIFFERENT ${input.file || JSON.stringify(code).slice(0, 300)} [${ext}]\n  only ts-eslint: ${r.theirs.filter(x => !r.ours.includes(x)).slice(0, 8).join(" | ") || "-"}\n  only sim:       ${r.ours.filter(x => !r.theirs.includes(x)).slice(0, 8).join(" | ") || "-"}`);
	}
}
console.log(JSON.stringify(tally));
