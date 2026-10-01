// Scratch: start of a reported comparison (ESLint: first token of the node, a parenthesis of the left operand included)
// and end of the operand of `!`, both derived with the forward scan plus a backward step over blanks and `(`.
const { scan, eslintReports: _unused } = require("./scan.cjs");
const { Linter } = require("eslint");
const espree = require("espree");
const linter = new Linter();

function walk(node, visit) {
	if (!node || typeof node.type !== "string") return;
	visit(node);
	for (const key of Object.keys(node)) {
		if (key === "parent") continue;
		const value = node[key];
		if (Array.isArray(value)) for (const item of value) walk(item, visit);
		else if (value && typeof value === "object") walk(value, visit);
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
	const regexes = new Map();
	const jsx = new Map();
	for (const n of nodes)
		walk(n, inner => {
			if (inner.type === "Literal" && inner.regex) regexes.set(inner.range[0], inner.range[1] - inner.range[0]);
			if (inner.type === "JSXElement" || inner.type === "JSXFragment") jsx.set(inner.range[0], inner.range[1]);
		});
	return { regexes, jsx };
}
// Full depth scan that does not stop at the first negative depth.
function minDepth(code, from, to, sp) {
	// scan() stops at depth < 0; rerun with a loop that lifts the floor.
	let floor = 0;
	let at = from;
	for (;;) {
		const r = scan(code, at, to, sp.regexes, sp.jsx);
		if (r.unknown) return null;
		if (!r.parenthesised) return floor;
		// find the `)` that made it negative: it is the first `)` at or after r.end with only trivia between
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
function backOverParens(code, at, count) {
	let i = at;
	let found = 0;
	let pos = at;
	while (found < count) {
		let k = i - 1;
		while (k >= 0 && (code[k] === " " || code[k] === "\t")) k--;
		if (k < 0 || code[k] !== "(") return null;
		found++;
		pos = k;
		i = k;
	}
	return pos;
}
function offsetOf(code, line, column) {
	const lines = code.split("\n");
	let offset = 0;
	for (let i = 0; i < line - 1; i++) offset += lines[i].length + 1;
	return offset + column - 1;
}

const lefts = [
	"x", "(x)", "((x))", "( x )", "(\tx)", "(x + 1)", "(x).y", "((x).y)", "(x)(')')", "(f(')'))", "(x, y)",
	"(/\\(/)", "(`(`)", "(/* ( */ x)", "(// (\n x)", "(\n x)", "( /* c */ (x))", "((x) /* ) */ )", "(<a>(</a>)",
	"(x) /* ) */ ", "-(x)", "(-x)", "((x))[')']",
];
const rights = ["-0", "NaN", "(-0)", "-(0)", "(NaN)", "/* ( */ -0"];
const ops = ["===", "<"];
const contexts = [e => e, e => `(${e})`, e => `if (${e}) {}`, e => `f(${e})`, e => `((${e}))`, e => `( /* ( */ (${e}))`, e => `y = ${e}`];
let checked = 0, exact = 0, fallback = 0, bad = 0;
for (const left of lefts)
	for (const right of rights)
		for (const op of ops)
			for (const context of contexts) {
				const code = context(`${left} ${op} ${right}`);
				const msgs = linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } }, rules: { "no-compare-neg-zero": "error", "use-isnan": "error" } }], { filename: "x.js" });
				if (msgs.some(m => m.fatal)) { console.log("NOPARSE " + JSON.stringify(code)); continue; }
				const ast = espree.parse(code, { ecmaVersion: "latest", sourceType: "module", range: true, ecmaFeatures: { jsx: true } });
				const wanted = new Set(msgs.map(m => offsetOf(code, m.line, m.column)));
				walk(ast, node => {
					if (node.type !== "BinaryExpression" || !ops.includes(node.operator)) return;
					if (!wanted.has(node.range[0])) return;
					checked++;
					const bunLoc = leftmost(node.left);
					const sp = spans(code, [node.left, node.right]);
					const floor = minDepth(code, bunLoc, leftmost(node.right), sp);
					if (floor === null) { bad++; console.log("UNKNOWN " + JSON.stringify(code)); return; }
					const start = floor === 0 ? bunLoc : backOverParens(code, bunLoc, -floor);
					if (start === null) { fallback++; return; }
					if (start === node.range[0]) exact++;
					else { bad++; console.log(`WRONG start=${start} eslint=${node.range[0]} ` + JSON.stringify(code)); }
				});
			}
console.log(`${checked} reports, ${exact} exact starts, ${fallback} fell back (comment or line break before the operand), ${bad} wrong`);
