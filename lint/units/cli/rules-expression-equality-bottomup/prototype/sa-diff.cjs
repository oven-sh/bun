// Differential check of the no-self-assign prototype (selfassign.cjs) against ESLint at the pin.
// usage: node sa-diff.cjs <cases.json> [--show]
"use strict";
const path = require("path");
const fs = require("fs");
const espree = require(path.join(__dirname, "eslint-pin/node_modules/espree"));
const { Linter } = require(path.join(__dirname, "eslint-pin/lib/linter"));
const { convert } = require("./bunlike.cjs");
const { createRule } = require("./selfassign.cjs");

const linter = new Linter({ configType: "flat" });

function byteOffsets(code) {
	const map = new Array(code.length + 1);
	let b = 0;
	for (let i = 0; i < code.length; i++) {
		map[i] = b;
		const cp = code.codePointAt(i);
		if (cp > 0xffff) {
			map[i + 1] = b;
			i += 1;
			b += 4;
		} else b += cp < 0x80 ? 1 : cp < 0x800 ? 2 : 3;
	}
	map[code.length] = b;
	return map;
}

const EXPR = new Set([
	"Identifier", "PrivateIdentifier", "ThisExpression", "Super", "Literal", "TemplateLiteral", "TaggedTemplateExpression",
	"ChainExpression", "MemberExpression", "CallExpression", "NewExpression", "AssignmentExpression", "BinaryExpression",
	"LogicalExpression", "SequenceExpression", "ConditionalExpression", "UnaryExpression", "AwaitExpression", "YieldExpression",
	"UpdateExpression", "ArrayExpression", "ObjectExpression", "FunctionExpression", "ArrowFunctionExpression", "ClassExpression",
	"MetaProperty", "ImportExpression", "SpreadElement",
]);

function mine(code, opts) {
	const ast = espree.parse(code, { ecmaVersion: "latest", range: true, loc: true, sourceType: opts.sourceType, ecmaFeatures: { jsx: false } });
	const src = Buffer.from(code, "utf8");
	const at = byteOffsets(code);
	const { expr } = convert(ast, at);
	const reports = [];
	const rule = createRule(src, r => reports.push(r));

	function walkBun(e) {
		if (e === null) return;
		switch (e.kind) {
			case "EBinary":
				rule.onBinary(e);
				walkBun(e.right);
				walkBun(e.left);
				break;
			case "EDot":
				walkBun(e.target);
				break;
			case "EIndex":
				walkBun(e.target);
				walkBun(e.index);
				break;
			case "ECall":
			case "ENew":
				walkBun(e.target);
				e.args.forEach(walkBun);
				break;
			case "EIf":
				walkBun(e.test);
				walkBun(e.yes);
				walkBun(e.no);
				break;
			case "EUnary":
			case "ESpread":
			case "EImport":
				walkBun(e.value);
				break;
			case "EArray":
				e.items.forEach(walkBun);
				break;
			case "EObject":
				for (const p of e.properties) {
					walkBun(p.key);
					walkBun(p.value);
					walkBun(p.initializer);
				}
				break;
			case "ETemplate":
				walkBun(e.tag);
				e.parts.forEach(walkBun);
				break;
			case "EFunction":
				e.params.forEach(walkBinding);
				walkEs(e.body);
				break;
			case "EClass":
				walkClass(e.node);
				break;
			default:
				break;
		}
	}
	function walkBinding(p) {
		if (!p) return;
		switch (p.type) {
			case "Identifier":
				break;
			case "ArrayPattern":
				p.elements.forEach(walkBinding);
				break;
			case "ObjectPattern":
				for (const q of p.properties) {
					if (q.type === "RestElement") walkBinding(q.argument);
					else {
						if (q.computed) walkBun(expr(q.key, false));
						walkBinding(q.value);
					}
				}
				break;
			case "RestElement":
				walkBinding(p.argument);
				break;
			case "AssignmentPattern":
				walkBinding(p.left);
				walkBun(expr(p.right, false));
				break;
			default:
				throw new Error("binding " + p.type);
		}
	}
	function walkClass(n) {
		if (n.superClass) walkBun(expr(n.superClass, false));
		for (const m of n.body.body) {
			if (m.type === "StaticBlock") m.body.forEach(walkEs);
			else {
				if (m.computed) walkBun(expr(m.key, false));
				if (m.value) walkBun(expr(m.value, false));
			}
		}
	}
	function walkEs(n) {
		if (!n || typeof n.type !== "string") return;
		if (EXPR.has(n.type)) {
			walkBun(expr(n, false));
			return;
		}
		switch (n.type) {
			case "VariableDeclarator":
				walkBinding(n.id);
				if (n.init) walkBun(expr(n.init, false));
				return;
			case "FunctionDeclaration":
				n.params.forEach(walkBinding);
				walkEs(n.body);
				return;
			case "ClassDeclaration":
				walkClass(n);
				return;
			case "CatchClause":
				walkBinding(n.param);
				walkEs(n.body);
				return;
			case "ForInStatement":
			case "ForOfStatement":
				if (n.left.type === "VariableDeclaration") walkEs(n.left);
				else {
					const head = expr(n.left, true);
					rule.onForHead(head);
					walkBun(head);
				}
				walkBun(expr(n.right, false));
				walkEs(n.body);
				return;
			default:
				break;
		}
		for (const k of Object.keys(n)) {
			if (k === "parent" || k === "loc" || k === "range") continue;
			const v = n[k];
			if (Array.isArray(v)) v.forEach(walkEs);
			else if (v && typeof v === "object") walkEs(v);
		}
	}
	walkEs(ast);
	return { reports, at };
}

function lineColToIndex(code, line, column) {
	let l = 1;
	let i = 0;
	while (l < line) {
		const ch = code[i];
		if (ch === "\r" && code[i + 1] === "\n") i += 1;
		if (ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029") l += 1;
		i += 1;
	}
	return i + column - 1;
}

module.exports = { mine, lineColToIndex };
if (require.main === module) {
const cases = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const show = process.argv.includes("--show");
let bad = 0;
let total = 0;
let skipped = 0;
let fallback = 0;
for (const c of cases) {
	const code = typeof c === "string" ? c : c.code;
	const sourceType = (typeof c === "object" && c.sourceType) || "script";
	total += 1;
	const t = linter.verify(code, [
		{ languageOptions: { ecmaVersion: "latest", sourceType }, rules: { "no-self-assign": "error" } },
	]);
	if (t.some(x => x.fatal)) {
		skipped += 1;
		if (show) console.log("SKIP", JSON.stringify(code), t[0].message);
		continue;
	}
	let m;
	try {
		m = mine(code, { sourceType });
	} catch (e) {
		bad += 1;
		console.log("THROW", JSON.stringify(code), e.stack.split("\n").slice(0, 3).join(" | "));
		continue;
	}
	const want = t
		.map(x => {
			const s = m.at[lineColToIndex(code, x.line, x.column)];
			const e = m.at[lineColToIndex(code, x.endLine, x.endColumn)];
			return `${s}+${e - s} ${x.message}`;
		})
		.sort();
	fallback += m.reports.filter(r => r.name === null).length;
	const got = m.reports.map(r => `${r.start}+${r.len} '${r.name}' is assigned to itself.`).sort();
	const same = want.length === got.length && want.every((w, i) => w === got[i]);
	if (!same) {
		bad += 1;
		console.log("DIFF", JSON.stringify(code), "\n   eslint:", JSON.stringify(want), "\n   mine:  ", JSON.stringify(got));
	} else if (show) {
		console.log("ok  ", JSON.stringify(code), JSON.stringify(got));
	}
}
console.log(`total=${total} skipped=${skipped} differ=${bad} fallbackReports=${fallback}`);

}
