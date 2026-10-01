// PROTOTYPE of the research: no-dupe-else-if the way the Rust module is to do it, to compare with ESLint at the pin.
// What it may use is what Bun has: the kind of a node and its operands (never a range), and the tokens between the
// `(` after `if` and the `)` that closes it. A range of tokens is split at the last `||` or `&&` that no bracket holds.
// usage: node proto-dupe-else-if.cjs [cases.json ...]     (default: the upstream cases, then generated chains)
//        node proto-dupe-else-if.cjs --random <count> [seed]
"use strict";
const path = require("path");
const fs = require("fs");
const eslintDir = "/workspace/ref/eslint";
const { Linter } = require(path.join(eslintDir, "lib/linter"));
const espree = require(path.join(eslintDir, "node_modules/espree"));
const linter = new Linter({ configType: "flat" });

function eslintReports(code) {
	const messages = linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType: "script" }, rules: { "no-dupe-else-if": "error" } }]);
	if (messages.some(m => m.fatal)) return null;
	return messages.map(m => `${m.line}:${m.column}`);
}

const OPEN = new Set(["(", "[", "{"]);
const CLOSE = new Set([")", "]", "}"]);
// One token of a template is `...${` or `}...${` or `}...`: espree gives them as Template tokens, which open and close nothing here.
function depthOf(tokens) {
	const depth = [];
	let d = 0;
	for (const t of tokens) {
		if (t.type === "Punctuator" && CLOSE.has(t.value)) d--;
		depth.push(d);
		if (t.type === "Punctuator" && OPEN.has(t.value)) d++;
		if (t.type === "Template") {
			// `a${` opens a level, `}b` closes one: the tokens between them are deeper.
			const opens = t.value.endsWith("${");
			const closes = t.value.startsWith("}");
			if (closes) depth[depth.length - 1] = --d;
			if (opens) d++;
		}
	}
	return depth;
}

function analyse(code) {
	const ast = espree.parse(code, { ecmaVersion: "latest", range: true, tokens: true, loc: true });
	const all = ast.tokens;
	const reports = [];
	function testTokens(ifNode) {
		// From the `if`: the `(` is the next token, and the test ends before the `)` that closes it.
		const start = all.findIndex(t => t.range[0] === ifNode.range[0]);
		if (all[start].value !== "if" || all[start + 1].value !== "(") throw new Error("not an if");
		let d = 0;
		let i = start + 2;
		const out = [];
		for (; ; i++) {
			const t = all[i];
			if (t.type === "Punctuator" && (t.value === "(" || t.value === "[" || t.value === "{")) d++;
			if (t.type === "Punctuator" && (t.value === ")" || t.value === "]" || t.value === "}")) {
				if (d === 0) break;
				d--;
			}
			out.push(t);
		}
		return out;
	}
	// A condition: { node, tokens, depth, lo, hi } with the parentheses around it stripped.
	function strip(c) {
		let { lo, hi } = c;
		for (;;) {
			if (hi - lo < 2) break;
			const first = c.tokens[lo];
			if (!(first.type === "Punctuator" && first.value === "(")) break;
			// Its `)` is the next token at the same depth that closes.
			let j = lo + 1;
			while (j < hi && !(c.depth[j] === c.depth[lo] && c.tokens[j].type === "Punctuator" && c.tokens[j].value === ")")) j++;
			if (j !== hi - 1) break;
			lo++;
			hi--;
		}
		return { ...c, lo, hi };
	}
	const isLogical = (node, op) => node.type === "LogicalExpression" && node.operator === op;
	function halves(c, op) {
		// The last token `op` of the range that stands at the depth of its first token.
		const d = c.depth[c.lo];
		for (let i = c.hi - 1; i >= c.lo; i--) {
			const t = c.tokens[i];
			if (c.depth[i] === d && t.type === "Punctuator" && t.value === op) {
				return [strip({ ...c, node: c.node.left, hi: i }), strip({ ...c, node: c.node.right, lo: i + 1 })];
			}
		}
		throw new Error("no operator in the range");
	}
	function split(c, op) {
		if (!isLogical(c.node, op)) return [c];
		const [l, r] = halves(c, op);
		return [...split(l, op), ...split(r, op)];
	}
	function canon(c) {
		const n = c.node;
		if (n.type === "LogicalExpression" && (n.operator === "||" || n.operator === "&&")) {
			const [l, r] = halves(c, n.operator).map(canon);
			const [x, y] = l <= r ? [l, r] : [r, l];
			return `L${n.operator}(${x.length}:${x}${y.length}:${y})`;
		}
		return "T" + c.tokens.slice(c.lo, c.hi).map(t => `${t.type}\u0000${t.value}`).join("\u0001");
	}
	function whole(ifNode) {
		const tokens = testTokens(ifNode);
		return strip({ node: ifNode.test, tokens, depth: depthOf(tokens), lo: 0, hi: tokens.length });
	}
	const orOperands = c => split(c, "||").map(o => new Set(split(o, "&&").map(canon)));
	const isSubset = (a, b) => [...a].every(x => b.has(x));
	function chain(head) {
		const members = [head];
		while (members.at(-1).alternate && members.at(-1).alternate.type === "IfStatement") members.push(members.at(-1).alternate);
		const tests = members.map(whole);
		const ors = tests.map(orOperands);
		for (let i = 1; i < members.length; i++) {
			const test = tests[i];
			const toCheck = isLogical(test.node, "&&") ? [test, ...split(test, "&&")] : [test];
			let list = toCheck.map(orOperands);
			for (let j = i - 1; j >= 0; j--) {
				list = list.map(os => os.filter(o => !ors[j].some(cur => isSubset(cur, o))));
				if (list.some(os => os.length === 0)) {
					const at = test.tokens[test.lo].loc.start;
					reports.push(`${at.line}:${at.column + 1}`);
					break;
				}
			}
		}
	}
	(function walk(node, parent, key) {
		if (!node || typeof node.type !== "string") return;
		if (node.type === "IfStatement" && !(parent && parent.type === "IfStatement" && key === "alternate")) chain(node);
		for (const k of Object.keys(node)) {
			if (k === "parent" || k === "tokens" || k === "loc" || k === "range") continue;
			const v = node[k];
			if (Array.isArray(v)) v.forEach(x => walk(x, node, k));
			else if (v && typeof v === "object") walk(v, node, k);
		}
	})(ast, null, null);
	return reports.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function compare(codes) {
	let same = 0;
	let differ = 0;
	let rejected = 0;
	let reported = 0;
	for (const code of codes) {
		const theirs = eslintReports(code);
		if (theirs === null) {
			rejected++;
			continue;
		}
		let ours;
		try {
			ours = analyse(code);
		} catch (e) {
			ours = ["ERROR " + e.message];
		}
		const a = [...theirs].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })).join(" ");
		if (theirs.length) reported++;
		if (a === ours.join(" ")) same++;
		else {
			differ++;
			console.log(`DIFFERS ${JSON.stringify(code)}\n    eslint: ${a || "(none)"}\n    proto:  ${ours.join(" ") || "(none)"}`);
		}
	}
	console.log(`${codes.length} cases: ${same} the same, ${differ} differ, ${rejected} that the parser rejects, ${reported} with a report of ESLint`);
}

function random(count, seed) {
	let s = seed >>> 0;
	const rnd = n => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s % n;
	};
	const atoms = ["a", "b", "c", "(a)", "a.b", "a['b']", "f(a)", "f((a))", "!a", "a === 1", "a === 1.0", "a ?? b", "(a ?? b)", "a ? b : c", "`x${a || b}`", "/a||b/", "(a, b)", "a = b", "[a || b]", "{}.a", "a++", "x => x || y"];
	function expr(depth) {
		const k = rnd(depth <= 0 ? 3 : 10);
		if (k < 3) {
			const atom = atoms[rnd(atoms.length)];
			// An atom of lower precedence than `&&` stands in parentheses.
			return /^(a \? b : c|a = b|x => x \|\| y|a \?\? b)$/.test(atom) ? `(${atom})` : atom;
		}
		const op = rnd(2) ? "||" : "&&";
		let l = expr(depth - 1);
		let r = expr(depth - 1);
		if (rnd(3) === 0) l = `(${l})`;
		if (rnd(3) === 0) r = `(${r})`;
		if (rnd(5) === 0) r = `((${r}))`;
		// `??` is not mixed with the two others without parentheses: the atoms that hold it are in parentheses already or are wrapped here.
		const wrap = x => (/\?\?/.test(x) && !/^\(.*\)$/.test(x) ? `(${x})` : x);
		return `${wrap(l)} ${op} ${wrap(r)}`;
	}
	const codes = [];
	for (let i = 0; i < count; i++) {
		const n = 2 + rnd(4);
		const tests = [];
		for (let j = 0; j < n; j++) {
			// A later test is often an earlier one, or a part of one, or two of them joined.
			const k = rnd(6);
			if (j > 0 && k === 0) tests.push(tests[rnd(j)]);
			else if (j > 0 && k === 1) tests.push(`${tests[rnd(j)]} && ${expr(1)}`);
			else if (j > 1 && k === 2) tests.push(`(${tests[rnd(j)]}) || (${tests[rnd(j)]})`);
			else if (j > 0 && k === 3) {
				const parts = tests[rnd(j)].split(/ (\|\||&&) /);
				tests.push(parts.length >= 3 && rnd(2) ? `${parts[2]} ${parts[1]} ${parts[0]}` : parts[0]);
			} else tests.push(expr(2));
		}
		codes.push(tests.map((t, j) => `${j ? "else " : ""}if (${t}) {}`).join(" "));
	}
	return codes;
}

const args = process.argv.slice(2);
if (args[0] === "--random") {
	compare(random(Number(args[1] || 1000), Number(args[2] || 1)));
} else {
	const files = args.length ? args : [path.join(__dirname, "..", "cases", "upstream-no-dupe-else-if.json")];
	for (const f of files) {
		const text = fs.readFileSync(f, "utf8");
		const parsed = f.endsWith(".jsonl") ? text.split("\n").filter(Boolean).map(l => JSON.parse(l)) : JSON.parse(text);
		const flat = Array.isArray(parsed) ? parsed : [...parsed.valid, ...parsed.invalid];
		compare(flat.map(c => (typeof c === "string" ? c : c.code)));
	}
}
