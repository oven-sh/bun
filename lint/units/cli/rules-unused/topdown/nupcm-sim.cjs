// Research scratch of "rules-unused" (pass 1b): no-unused-private-class-members AS PLANNED for src/lint, in JavaScript,
// on ESLint's tree, compared with ESLint's rule at the pin. The plan reads no parent: the node ABOVE a member decides
// whether the member is only written, before the walk reaches the member (a set of member nodes), and a private name
// is looked up in the class bodies whose text range holds it (a stack pushed when the class node is entered).
// What stands for Bun's tree: a TypeScript wrapper node (as, satisfies, !, <T>) is what the side table records; there
// is no parenthesis node and no ChainExpression node; the init of a `for` is an expression statement in Bun's tree.
// usage: node nupcm-sim.cjs [--show N] [--ext e] <file | cases.json | --code "..." | --list files.txt>...
//   a .json is ["code"] or [{code, ext}] or {valid:[...], invalid:[...]} of ESLint's RuleTester.
"use strict";
const fs = require("fs");
const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const { visitorKeys: tsKeys } = require("module").createRequire("/workspace/ref/tseslint/node_modules/@typescript-eslint/scope-manager/")("@typescript-eslint/visitor-keys");

const TS_WRAPPERS = new Set(["TSNonNullExpression", "TSAsExpression", "TSSatisfiesExpression", "TSTypeAssertion"]);
// The operand under the wrappers, and whether a TypeScript wrapper was among them.
function strip(node) {
	let ts = false;
	while (node && (TS_WRAPPERS.has(node.type) || node.type === "ChainExpression")) {
		if (node.type !== "ChainExpression") ts = true;
		node = node.expression;
	}
	return { node, ts };
}
const isPrivateMember = n => !!n && n.type === "MemberExpression" && n.property.type === "PrivateIdentifier";

function simulate(ast, visitorKeys) {
	const classes = []; // {from, to, members: Map(name -> {line, column, accessor, used})}, innermost last
	const writeOnly = new Set(); // member nodes that the node above them only writes
	const notStatement = new Set(); // ExpressionStatement nodes that stand for the init of a `for`
	const out = [];
	// `expr` stands where the node above only writes it.
	const target = expr => { const s = strip(expr); if (!s.ts && isPrivateMember(s.node)) writeOnly.add(s.node); };
	const lookup = (name, pos) => {
		for (let i = classes.length - 1; i >= 0; i--) {
			const c = classes[i];
			if (pos >= c.from && pos < c.to && c.members.has(name)) return c.members.get(name);
		}
		return null;
	};
	function walk(node) {
		if (!node || typeof node.type !== "string") return;
		let frame = null;
		switch (node.type) {
			case "ClassDeclaration":
			case "ClassExpression": {
				const members = new Map();
				for (const m of node.body.body) {
					if ((m.type === "PropertyDefinition" || m.type === "MethodDefinition") && m.key.type === "PrivateIdentifier") {
						// The last declaration of a name gives the place and the kind; the first gives the order.
						members.set(m.key.name, { line: m.key.loc.start.line, column: m.key.loc.start.column + 1, accessor: m.type === "MethodDefinition" && (m.kind === "get" || m.kind === "set"), used: false });
					}
				}
				frame = { from: node.body.range[0], to: node.body.range[1], members };
				classes.push(frame);
				break;
			}
			case "ExpressionStatement": {
				if (notStatement.has(node)) break;
				const s = strip(node.expression);
				if (s.ts) break;
				if (s.node.type === "AssignmentExpression" && s.node.operator !== "=") target(s.node.left);
				else if (s.node.type === "UpdateExpression") target(s.node.argument);
				break;
			}
			case "AssignmentExpression":
				if (node.operator === "=") target(node.left);
				break;
			case "AssignmentPattern":
				target(node.left);
				break;
			case "ForInStatement":
			case "ForOfStatement":
				if (node.left.type !== "VariableDeclaration") target(node.left);
				break;
			case "ArrayPattern":
				for (const e of node.elements) if (e) target(e.type === "RestElement" ? e.argument : e);
				break;
			case "ObjectPattern":
				for (const p of node.properties) target(p.type === "RestElement" ? p.argument : p.value);
				break;
			case "MemberExpression":
				if (node.property.type === "PrivateIdentifier") {
					const m = lookup(node.property.name, node.property.range[0]);
					if (m && (m.accessor || !writeOnly.has(node))) m.used = true;
				}
				break;
			case "BinaryExpression":
				if (node.left.type === "PrivateIdentifier") {
					const m = lookup(node.left.name, node.left.range[0]);
					if (m) m.used = true;
				}
				break;
		}
		for (const k of visitorKeys[node.type] || []) {
			const child = node[k];
			if (Array.isArray(child)) child.forEach(walk);
			else walk(child);
		}
		if (frame) {
			classes.pop();
			for (const [name, m] of frame.members) if (!m.used) out.push(`${m.line}:${m.column} '#${name}' is defined but never used.`);
		}
	}
	walk(ast);
	return out;
}

const linter = new Linter({ configType: "flat" });
let current = null;
const simRule = { create(context) { return { "Program:exit"(ast) { current = simulate(ast, context.sourceCode.visitorKeys); } }; } };
function run(code, ext) {
	current = null;
	const isTs = /^(d\.)?[cm]?tsx?$/.test(ext);
	const sourceType = ext === "cjs" || ext === "cts" ? "commonjs" : ext === "js" || ext === "jsx" ? "script" : "module";
	const languageOptions = isTs ? { parser: tsParser, ecmaVersion: "latest", sourceType } : { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: ext === "jsx" } } };
	const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions, plugins: { sim: { rules: { nupcm: simRule } } }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { "no-unused-private-class-members": "error", "sim/nupcm": "error" } }];
	let messages;
	try { messages = linter.verify(code, config, { filename: `c.${ext}` }); } catch (e) { return { crash: String((e && e.stack) || e).slice(0, 600) }; }
	if (messages.some(m => m.fatal)) return null;
	if (messages.some(m => m.ruleId === "sim/nupcm")) return { crash: JSON.stringify(messages.filter(m => m.ruleId === "sim/nupcm").slice(0, 2)) };
	const theirs = messages.filter(m => m.ruleId === "no-unused-private-class-members").map(m => `${m.line}:${m.column} ${m.message}`).sort();
	return { theirs, ours: (current || []).slice().sort() };
}
const args = process.argv.slice(2);
let show = 20, forceExt = null;
const inputs = [];
const push = c => inputs.push(typeof c === "string" ? { code: c } : { code: c.code, ext: c.ext || (c.jsx ? "jsx" : undefined) });
while (args.length) {
	const a = args.shift();
	if (a === "--show") show = Number(args.shift());
	else if (a === "--ext") forceExt = args.shift();
	else if (a === "--code") inputs.push({ code: args.shift() });
	else if (a === "--list") for (const f of fs.readFileSync(args.shift(), "utf8").split("\n").filter(Boolean)) inputs.push({ file: f });
	else if (a.endsWith(".json")) { const j = JSON.parse(fs.readFileSync(a, "utf8")); if (Array.isArray(j)) j.forEach(push); else for (const k of ["valid", "invalid"]) (j[k] || []).forEach(push); }
	else inputs.push({ file: a });
}
const tally = { inputs: 0, same: 0, different: 0, rejected: 0, crashed: 0, reports: 0, withPrivate: 0 };
let shown = 0;
for (const input of inputs) {
	let code = input.code, ext = forceExt || input.ext || "js";
	if (input.file) {
		try { code = fs.readFileSync(input.file, "utf8").replace(/^\uFEFF/, ""); } catch { continue; }
		const m = /\.(d\.ts|d\.mts|d\.cts|tsx|mts|cts|ts|jsx|mjs|cjs|js)$/.exec(input.file);
		if (!m) continue;
		ext = forceExt || m[1];
	}
	tally.inputs += 1;
	let r = run(code, ext);
	if (r === null && ext === "js") r = run(code, "mjs");
	if (r === null && ext === "js") r = run(code, "jsx");
	if (r === null) { tally.rejected += 1; continue; }
	if (r.crash) { tally.crashed += 1; if (shown++ < show) console.log(`CRASH ${input.file || JSON.stringify(code).slice(0, 200)}\n  ${r.crash}`); continue; }
	if (/#[A-Za-z_$]/.test(code)) tally.withPrivate += 1;
	tally.reports += r.theirs.length;
	if (JSON.stringify(r.theirs) === JSON.stringify(r.ours)) tally.same += 1;
	else {
		tally.different += 1;
		if (shown++ < show) console.log(`DIFFERENT ${input.file || JSON.stringify(code).slice(0, 400)} [${ext}]\n  only eslint: ${r.theirs.filter(x => !r.ours.includes(x)).slice(0, 8).join(" | ") || "-"}\n  only sim:    ${r.ours.filter(x => !r.theirs.includes(x)).slice(0, 8).join(" | ") || "-"}`);
	}
}
console.log(JSON.stringify(tally));
