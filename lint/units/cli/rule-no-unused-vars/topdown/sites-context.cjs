// Research scratch of "rule-no-unused-vars": the context rules of the probe (probe/src/main.rs), written on ESLint's tree,
// against the same facts read with parent pointers (sites-estree.cjs computes those for the comparison with bun).
// It answers: do the three context values of one top-down walk give what ESLint's parent walks give? No bun is needed.
// usage: node sites-context.cjs [--show N] [--list files.txt] <file>...
"use strict";
const fs = require("fs");
const espree = require("/workspace/ref/eslint/node_modules/espree");
const evk = require("/workspace/ref/eslint/node_modules/eslint-visitor-keys");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const args = process.argv.slice(2);
let show = 30;
const files = [];
while (args.length) {
	const a = args.shift();
	if (a === "--show") show = Number(args.shift());
	else if (a === "--list") files.push(...fs.readFileSync(args.shift(), "utf8").split("\n").filter(Boolean));
	else files.push(a);
}
const isFn = n => n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression";
const isLoop = n => /^(?:DoWhile|For|ForIn|ForOf|While)Statement$/.test(n.type);
const LOGICAL = new Set(["&&=", "||=", "??="]);
function parse(code, file) {
	const ext = file.split(".").pop();
	if (/^[cm]?tsx?$/.test(ext)) {
		try { const r = tsParser.parseForESLint(code, { range: true, sourceType: "module", ecmaFeatures: { jsx: ext === "tsx" }, filePath: file }); return { ast: r.ast, keys: r.visitorKeys }; } catch { return null; }
	}
	for (const sourceType of ext === "mjs" ? ["module"] : ext === "cjs" ? ["commonjs"] : ["module", "script", "commonjs"]) {
		try { return { ast: espree.parse(code, { ecmaVersion: "latest", sourceType, ecmaFeatures: { jsx: true }, range: true }), keys: evk.KEYS }; } catch {}
	}
	return null;
}
function unusedExpression(node) {
	const parent = node.parent;
	if (parent.type === "ExpressionStatement") return true;
	if (parent.type === "SequenceExpression") return parent.expressions.at(-1) !== node ? true : unusedExpression(parent);
	return false;
}
// A: with parent pointers, as ESLint's rule asks.
function byParents(parsed) {
	const out = new Map();
	(function walk(node, parent) {
		if (!node || typeof node.type !== "string") return;
		node.parent = parent;
		if (node.type === "Identifier" || node.type === "JSXIdentifier") {
			let flags = "";
			if (parent.type === "AssignmentExpression" && parent.left === node) flags += "a" + (LOGICAL.has(parent.operator) ? "l" : "") + (unusedExpression(parent) ? "x" : "");
			if (parent.type === "UpdateExpression") flags += "u" + (unusedExpression(parent) ? "x" : "");
			if ((parent.type === "ForInStatement" || parent.type === "ForOfStatement") && (parent.left === node || parent.right === node)) {
				const first = parent.body.type === "BlockStatement" ? parent.body.body[0] : parent.body;
				if (first && first.type === "ReturnStatement") flags += "r";
			}
			let inLoop = false;
			for (let n = node; n && !isFn(n); n = n.parent) if (isLoop(n)) { inLoop = true; break; }
			if (inLoop) flags += "L";
			let f = node;
			while (f && !isFn(f)) f = f.parent;
			let verdict = " f:n";
			if (f) {
				verdict = " f:N";
				let child = f;
				for (let p = f.parent; p; child = p, p = p.parent) {
					if (p.type === "SequenceExpression") { if (p.expressions.at(-1) !== child) break; continue; }
					if (p.type === "CallExpression" || p.type === "NewExpression") { if (p.callee !== child) verdict = " f:y"; break; }
					if (p.type === "AssignmentExpression") { verdict = p.left.type === "Identifier" && p.left.name === node.name ? " f:As" : " f:Ao"; break; }
					if (p.type === "TaggedTemplateExpression" || p.type === "YieldExpression") { verdict = " f:y"; break; }
					if (p.type.endsWith("Statement") || p.type.endsWith("Declaration")) { verdict = " f:y"; break; }
				}
			}
			out.set(node, flags + verdict);
		}
		for (const k of parsed.keys[node.type] || evk.getKeys(node)) {
			const c = node[k];
			if (Array.isArray(c)) for (const x of c) walk(x, node);
			else walk(c, node);
		}
	})(parsed.ast, null);
	return out;
}
// B: with the context of one top-down walk: unused, loop depth, and what a function found here is (No, Yes, the assignment that decides).
function byContext(parsed) {
	const out = new Map();
	const pending = new Map();
	const flag = (id, text) => pending.set(id, (pending.get(id) || "") + text);
	const fns = [];
	function walk(node, cx) {
		if (!node || typeof node.type !== "string") return;
		if (node.type === "Identifier" || node.type === "JSXIdentifier") {
			const top = fns.at(-1);
			const verdict = top === undefined ? " f:n" : top === "No" ? " f:N" : top === "Yes" ? " f:y" : top.left === node.name ? " f:As" : " f:Ao";
			out.set(node, (pending.get(node) || "") + (cx.loop > 0 ? "L" : "") + verdict);
		}
		let loop = cx.loop;
		if (isLoop(node)) loop += 1;
		if (node.type === "AssignmentExpression" && node.left.type === "Identifier") flag(node.left, "a" + (LOGICAL.has(node.operator) ? "l" : "") + (cx.unused ? "x" : ""));
		if (node.type === "UpdateExpression" && node.argument.type === "Identifier") flag(node.argument, cx.unused ? "ux" : "u");
		if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
			const first = node.body.type === "BlockStatement" ? node.body.body[0] : node.body;
			if (first && first.type === "ReturnStatement") {
				if (node.left.type === "Identifier") flag(node.left, "r");
				if (node.right.type === "Identifier") flag(node.right, "r");
			}
		}
		const fn = isFn(node);
		if (fn) { fns.push(cx.storable); loop = 0; }
		for (const k of parsed.keys[node.type] || evk.getKeys(node)) {
			const child = node[k];
			const each = (c, i, list) => {
				if (!c || typeof c.type !== "string") return;
				let unused = false;
				if (node.type === "ExpressionStatement" && k === "expression") unused = true;
				else if (node.type === "SequenceExpression") unused = i !== list.length - 1 ? true : cx.unused;
				let storable;
				if (node.type === "SequenceExpression") storable = i === list.length - 1 ? cx.storable : "No";
				else if (node.type === "CallExpression" || node.type === "NewExpression") storable = k === "callee" ? "No" : "Yes";
				else if (node.type === "AssignmentExpression") storable = { left: node.left.type === "Identifier" ? node.left.name : null };
				else if (node.type === "TaggedTemplateExpression" || node.type === "YieldExpression") storable = "Yes";
				else if (node.type.endsWith("Statement") || node.type.endsWith("Declaration")) storable = "Yes";
				else storable = cx.storable;
				walk(c, { unused, loop, storable });
			};
			if (Array.isArray(child)) child.forEach((c, i) => each(c, i, child));
			else each(child, 0, [child]);
		}
		if (fn) fns.pop();
	}
	walk(parsed.ast, { unused: false, loop: 0, storable: "No" });
	return out;
}
const tally = { files: 0, rejected: 0, identifiers: 0, same: 0, different: 0 };
const shown = [];
for (const f of files) {
	let code;
	try { code = fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""); } catch { continue; }
	tally.files += 1;
	const parsed = parse(code, f);
	if (!parsed) { tally.rejected += 1; continue; }
	const a = byParents(parsed), b = byContext(parsed);
	for (const [node, flags] of a) {
		tally.identifiers += 1;
		if (b.get(node) === flags) tally.same += 1;
		else { tally.different += 1; if (shown.length < show) shown.push(`${f} @${node.range[0]} ${node.name}: parents "${flags}" context "${b.get(node)}" : ${JSON.stringify(code.slice(Math.max(0, node.range[0] - 40), node.range[0] + 30))}`); }
	}
}
console.log(JSON.stringify(tally));
for (const s of shown) console.log(s);
