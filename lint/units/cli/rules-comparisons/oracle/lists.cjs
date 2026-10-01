// Scratch: final case lists. For every case: what ESLint reports, and what the specified algorithm reports
// (start through the forward scan plus the backward step over blanks; no report when the file declares the name).
const { Linter } = require("eslint");
const espree = require("espree");
const eslintScope = require("eslint-scope");
const { scan } = require("./scan.cjs");
const linter = new Linter();

function walk(node, visit, parent) {
	if (!node || typeof node.type !== "string") return;
	visit(node, parent);
	for (const key of Object.keys(node)) {
		if (key === "parent") continue;
		const value = node[key];
		if (Array.isArray(value)) for (const item of value) walk(item, visit, node);
		else if (value && typeof value === "object") walk(value, visit, node);
	}
}
function leftmost(node) {
	for (;;) {
		switch (node.type) {
			case "BinaryExpression": case "LogicalExpression": case "AssignmentExpression": node = node.left; break;
			case "MemberExpression": node = node.object; break;
			case "CallExpression": node = node.callee; break;
			case "TaggedTemplateExpression": node = node.tag; break;
			case "SequenceExpression": node = node.expressions[0]; break;
			case "ConditionalExpression": node = node.test; break;
			case "ChainExpression": node = node.expression; break;
			case "UpdateExpression": if (node.prefix) return node.range[0]; node = node.argument; break;
			default: return node.range[0];
		}
	}
}
function spans(code, nodes) {
	const regexes = new Map(), jsx = new Map();
	for (const n of nodes) walk(n, inner => {
		if (inner.type === "Literal" && inner.regex) regexes.set(inner.range[0], inner.range[1] - inner.range[0]);
		if (inner.type === "JSXElement" || inner.type === "JSXFragment") jsx.set(inner.range[0], inner.range[1]);
	});
	return { regexes, jsx };
}
function minDepth(code, from, to, sp) {
	let floor = 0, at = from;
	for (;;) {
		const r = scan(code, at, to, sp.regexes, sp.jsx);
		if (r.unknown) return null;
		if (!r.parenthesised) return floor;
		let i = r.end;
		for (;;) {
			if (code[i] === ")") break;
			if (code[i] === "/" && code[i + 1] === "*") { i = code.indexOf("*/", i + 2) + 2; continue; }
			if (code[i] === "/" && code[i + 1] === "/") { while (i < to && !/[\n\r\u2028\u2029]/.test(code[i])) i++; continue; }
			i++;
		}
		floor--;
		at = i + 1;
	}
}
function parenBefore(code, at) {
	let k = at - 1;
	while (k >= 0 && (code[k] === " " || code[k] === "\t")) k--;
	return k >= 0 && code[k] === "(" ? k : null;
}
function binaryStart(code, node) {
	const own = leftmost(node.left);
	const floor = minDepth(code, own, leftmost(node.right), spans(code, [node.left, node.right]));
	if (floor === null) return own;
	let start = own;
	for (let n = 0; n < -floor; n++) {
		const p = parenBefore(code, start);
		if (p === null) return own;
		start = p;
	}
	return start;
}
function caseStart(code, test) {
	let k = leftmost(test);
	for (;;) {
		const p = parenBefore(code, k);
		if (p === null) break;
		k = p;
	}
	let e = k;
	while (e > 0 && (code[e - 1] === " " || code[e - 1] === "\t")) e--;
	if (code.slice(e - 4, e) === "case" && (e - 4 === 0 || !/[\w$\\#\u0080-\uffff]/.test(code[e - 5]))) return e - 4;
	return leftmost(test);
}
function lineCol(code, offset) {
	let line = 1, col = 1;
	for (let i = 0; i < offset; i++) {
		const c = code[i];
		if (c === "\n" || c === "\u2028" || c === "\u2029" || (c === "\r" && code[i + 1] !== "\n")) { line++; col = 1; } else if (c === "\r") { /* counted with \n */ } else col++;
	}
	return `${line}:${col}`;
}
function declared(ast) {
	const manager = eslintScope.analyze(ast, { ecmaVersion: 2026, sourceType: "module", ranges: true });
	const names = new Set();
	for (const scope of manager.scopes) for (const v of scope.variables) if (v.defs.length > 0) names.add(v.name);
	return names;
}
const isNegZero = n => n.type === "UnaryExpression" && n.operator === "-" && n.argument.type === "Literal" && n.argument.value === 0;
const COMPARE = new Set(["<", "<=", ">", ">=", "==", "===", "!=", "!=="]);
const EQUALITY = new Set(["==", "===", "!=", "!=="]);
const VALID = new Set(["symbol", "undefined", "object", "boolean", "number", "string", "function", "bigint"]);
function nanName(node) {
	if (!node) return null;
	const n = node.type === "SequenceExpression" ? node.expressions.at(-1) : node;
	if (n.type === "Identifier" && n.name === "NaN") return "NaN";
	const m = n.type === "ChainExpression" ? n.expression : n;
	if (m.type === "MemberExpression" && m.object.type === "Identifier" && m.object.name === "Number") {
		const p = m.property;
		const name = !m.computed && p.type === "Identifier" ? p.name : p.type === "Literal" && typeof p.value === "string" ? p.value : p.type === "TemplateLiteral" && p.expressions.length === 0 ? p.quasis[0].value.cooked : null;
		if (name === "NaN") return "Number";
	}
	return null;
}
function mine(code, rule) {
	const ast = espree.parse(code, { ecmaVersion: "latest", sourceType: "module", range: true, ecmaFeatures: { jsx: true } });
	const names = declared(ast);
	const out = [];
	walk(ast, node => {
		if (node.type === "BinaryExpression") {
			if (rule === "no-compare-neg-zero" && COMPARE.has(node.operator) && (isNegZero(node.left) || isNegZero(node.right)))
				out.push([binaryStart(code, node), `Do not use the '${node.operator}' operator to compare against -0.`]);
			if (rule === "use-isnan" && COMPARE.has(node.operator)) {
				const which = nanName(node.left) || nanName(node.right);
				const both = [nanName(node.left), nanName(node.right)].filter(Boolean);
				if (which && both.some(n => !names.has(n))) out.push([binaryStart(code, node), "Use the isNaN function to compare with NaN."]);
			}
			if (rule === "valid-typeof" && EQUALITY.has(node.operator)) {
				for (const [self, sibling] of [[node.left, node.right], [node.right, node.left]]) {
					if (self.type !== "UnaryExpression" || self.operator !== "typeof") continue;
					if (sibling.type === "Literal" || (sibling.type === "TemplateLiteral" && sibling.expressions.length === 0)) {
						const value = sibling.type === "Literal" ? sibling.value : sibling.quasis[0].value.cooked;
						if (!VALID.has(value)) out.push([sibling.range[0], "Invalid typeof comparison value."]);
					} else if (sibling.type === "Identifier" && sibling.name === "undefined" && !names.has("undefined")) {
						out.push([sibling.range[0], "Invalid typeof comparison value."]);
					}
				}
			}
			if (rule === "no-unsafe-negation" && (node.operator === "in" || node.operator === "instanceof") && node.left.type === "UnaryExpression" && node.left.operator === "!") {
				const sp = spans(code, [node.left.argument, node.right]);
				const r = scan(code, node.left.range[0] + 1, leftmost(node.right), sp.regexes, sp.jsx);
				if (!r.unknown && !r.parenthesised) out.push([node.left.range[0], `Unexpected negating the left operand of '${node.operator}' operator.`]);
			}
		}
		if (node.type === "SwitchStatement" && rule === "use-isnan") {
			const d = nanName(node.discriminant);
			if (d && !names.has(d)) out.push([node.range[0], "'switch(NaN)' can never match a case clause. Use Number.isNaN instead of the switch."]);
			for (const c of node.cases) {
				const t = nanName(c.test);
				if (t && !names.has(t)) out.push([caseStart(code, c.test), "'case NaN' can never match. Use Number.isNaN before the switch."]);
			}
		}
	});
	out.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
	return out.map(([at, message]) => `${lineCol(code, at)} ${message}`);
}
function theirs(code, rule) {
	const msgs = linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } }, rules: { [rule]: "error" } }], { filename: "x.js" });
	if (msgs.some(m => m.fatal)) return null;
	const out = msgs.map(m => [m.line, m.column, m.message]);
	out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : 1));
	return out.map(([l, c, m]) => `${l}:${c} ${m}`);
}
module.exports = { mine, theirs };
if (require.main === module) {
	const rule = process.argv[2];
	const file = process.argv[3];
	const cases = require("fs").readFileSync(file, "utf8").split(/^----\n/m).map(c => c.replace(/\n$/, "")).filter(Boolean);
	const seen = new Set();
	const groups = { valid: [], invalid: [], different: [] };
	for (const code of cases) {
		if (seen.has(code)) continue;
		seen.add(code);
		const t = theirs(code, rule);
		if (t === null) { console.log("NOPARSE " + JSON.stringify(code)); continue; }
		const m = mine(code, rule);
		const same = JSON.stringify(t) === JSON.stringify(m);
		if (!same) groups.different.push({ code, eslint: t, bun: m });
		else if (t.length === 0) groups.valid.push(code);
		else groups.invalid.push({ code, at: t });
	}
	const strip = (list, rule) => list.map(x => x.replace(/ .*$/, "")).join(" ");
	console.log(`### ${rule}: ${groups.valid.length} valid, ${groups.invalid.length} invalid, ${groups.different.length} different`);
	console.log("VALID");
	for (const c of groups.valid) console.log("  " + JSON.stringify(c));
	console.log("INVALID (code => line:col ...)");
	for (const c of groups.invalid) console.log("  " + JSON.stringify(c.code) + " => " + (process.argv[4] === "full" ? c.at.join(" | ") : strip(c.at)));
	console.log("DIFFERENT (ESLint / specified algorithm)");
	for (const c of groups.different) console.log("  " + JSON.stringify(c.code) + " => eslint " + (c.eslint.length ? strip(c.eslint) : "none") + " / bun " + (c.bun.length ? strip(c.bun) : "none"));
}
