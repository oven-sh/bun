const { scan } = require("./scan2.cjs");
const espree = require("espree");
const src = require("fs").readFileSync("./gen-nun.cjs", "utf8");
const operands = eval(src.match(/const operands = (\[[\s\S]*?\n\]);/)[1]);
function walk(node, visit) { if (!node || typeof node.type !== "string") return; visit(node); for (const key of Object.keys(node)) { if (key === "parent") continue; const v = node[key]; if (Array.isArray(v)) for (const it of v) walk(it, visit); else if (v && typeof v === "object") walk(v, visit); } }
function leftmost(node) { for (;;) { switch (node.type) { case "BinaryExpression": case "LogicalExpression": case "AssignmentExpression": node = node.left; break; case "MemberExpression": node = node.object; break; case "CallExpression": node = node.callee; break; case "TaggedTemplateExpression": node = node.tag; break; case "SequenceExpression": node = node.expressions[0]; break; case "ConditionalExpression": node = node.test; break; case "ChainExpression": node = node.expression; break; case "UpdateExpression": if (node.prefix) return node.range[0]; node = node.argument; break; default: return node.range[0]; } } }
const wrappers = [v => `!${v}`, v => `! /* ( */ ${v}`, v => `!${v} /* ) */`, v => `!${v}\n// )\n`];
const contexts = [e => e, e => `if (${e}) {}`, e => `foo(${e})`, e => "`${" + e + "}`"];
const rights = ["b", "(b)", "/* ( */ b", "(b).c", "((b))"];
let n = 0, exact = 0, unknown = 0, bad = 0;
for (const operand of operands) for (const wrap of wrappers) for (const context of contexts) for (const operator of ["in", "instanceof"]) for (const right of rights) {
	const code = context(`${wrap(operand)} ${operator} ${right}`);
	let ast;
	try { ast = espree.parse(code, { ecmaVersion: "latest", sourceType: "module", range: true, ecmaFeatures: { jsx: true } }); } catch { continue; }
	walk(ast, node => {
		if (node.type !== "BinaryExpression" || node.operator !== operator || node.left.type !== "UnaryExpression" || node.left.operator !== "!") return;
		const regexes = new Map(), jsx = new Map();
		for (const side of [node.left.argument, node.right]) walk(side, inner => { if (inner.type === "Literal" && inner.regex) regexes.set(inner.range[0], inner.range[1] - inner.range[0]); if (inner.type === "JSXElement" || inner.type === "JSXFragment") jsx.set(inner.range[0], inner.range[1]); });
		const r = scan(code, node.left.range[0] + 1, leftmost(node.right), regexes, jsx, operator);
		n++;
		if (r.unknown || r.parenthesised) { bad++; console.log("BAD " + JSON.stringify(r) + " " + JSON.stringify(code)); return; }
		if (r.end === -1) { unknown++; return; }
		if (r.end === node.left.range[1]) exact++; else { bad++; console.log(`WRONG end=${r.end} eslint=${node.left.range[1]} ` + JSON.stringify(code)); }
	});
}
console.log(`${n} candidates, ${exact} exact ends, ${unknown} without an end, ${bad} wrong`);
