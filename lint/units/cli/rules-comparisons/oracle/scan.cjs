// Scratch prototype: the forward parenthesis-depth scan, fed only with what Bun's tree gives
// (position of `!`, position of the first own token of the right operand, regular expression
// literals and JSX elements inside the operand). Compared with ESLint's own verdict.
const { Linter } = require("eslint");
const espree = require("espree");
const fs = require("fs");

const isLineTerminator = (text, i) => {
	const c = text.charCodeAt(i);
	return c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029;
};

// Returns { parenthesised, end } where end is the offset after the last token of the operand.
function scan(text, from, to, regexes, jsx) {
	let i = from;
	let depth = 0;
	let newlineBefore = false;
	let lastTokenEnd = from;
	let beforeLastTokenEnd = from;
	let lastWasWord = false;
	// One entry per open template substitution: the brace depth inside it.
	const templates = [];
	let braces = 0;
	const token = end => {
		beforeLastTokenEnd = lastTokenEnd;
		lastTokenEnd = end;
		newlineBefore = false;
	};
	const skipString = quote => {
		i++;
		while (i < to) {
			const c = text[i];
			if (c === "\\") {
				i += 2;
				continue;
			}
			i++;
			if (c === quote) return true;
		}
		return false;
	};
	// Entered after a backtick or after the `}` that closes a substitution.
	const skipTemplateText = () => {
		while (i < to) {
			const c = text[i];
			if (c === "\\") {
				i += 2;
				continue;
			}
			if (c === "`") {
				i++;
				return true;
			}
			if (c === "$" && text[i + 1] === "{") {
				i += 2;
				templates.push(braces);
				braces = 0;
				return true;
			}
			i++;
		}
		return false;
	};
	while (i < to) {
		const c = text[i];
		if (isLineTerminator(text, i)) {
			newlineBefore = true;
			i++;
			lastWasWord = false;
			continue;
		}
		if (regexes.has(i)) {
			i += regexes.get(i);
			token(i);
			lastWasWord = false;
			continue;
		}
		if (jsx.has(i)) {
			i = jsx.get(i);
			token(i);
			lastWasWord = false;
			continue;
		}
		if (c === "/" && text[i + 1] === "/") {
			i += 2;
			while (i < to && !isLineTerminator(text, i)) i++;
			lastWasWord = false;
			continue;
		}
		if (c === "/" && text[i + 1] === "*") {
			const close = text.indexOf("*/", i + 2);
			if (close === -1 || close + 2 > to) return { unknown: "comment" };
			for (let k = i; k < close; k++) if (isLineTerminator(text, k)) newlineBefore = true;
			i = close + 2;
			lastWasWord = false;
			continue;
		}
		if (c === "-" && text[i + 1] === "-" && text[i + 2] === ">" && newlineBefore) {
			i += 3;
			while (i < to && !isLineTerminator(text, i)) i++;
			lastWasWord = false;
			continue;
		}
		if (c === '"' || c === "'") {
			if (!skipString(c)) return { unknown: "string" };
			token(i);
			lastWasWord = false;
			continue;
		}
		if (c === "`") {
			i++;
			if (!skipTemplateText()) return { unknown: "template" };
			token(i);
			lastWasWord = false;
			continue;
		}
		if (c === "{") {
			braces++;
			i++;
			token(i);
			lastWasWord = false;
			continue;
		}
		if (c === "}") {
			if (braces === 0 && templates.length > 0) {
				braces = templates.pop();
				i++;
				if (!skipTemplateText()) return { unknown: "template" };
				token(i);
				lastWasWord = false;
				continue;
			}
			braces--;
			i++;
			token(i);
			lastWasWord = false;
			continue;
		}
		if (c === "(") {
			depth++;
			i++;
			token(i);
			lastWasWord = false;
			continue;
		}
		if (c === ")") {
			depth--;
			if (depth < 0) return { parenthesised: true, end: lastTokenEnd };
			i++;
			token(i);
			lastWasWord = false;
			continue;
		}
		if (/\s/u.test(c) || c === "\ufeff") {
			i++;
			lastWasWord = false;
			continue;
		}
		// A word (name, keyword, number) is one token; anything else is one token per character.
		const word = /[\p{ID_Continue}$\u200c\u200d\\]/u.test(c);
		if (word && lastWasWord) {
			lastTokenEnd = i + 1;
		} else {
			token(i + 1);
		}
		lastWasWord = word;
		i++;
	}
	if (i !== to) return { unknown: "overrun" };
	// Not parenthesised: the tokens of the range are the operand, the operator, then `(`s.
	return { parenthesised: false, depth };
}

function leftmost(node) {
	for (;;) {
		switch (node.type) {
			case "BinaryExpression":
			case "LogicalExpression":
			case "AssignmentExpression":
				node = node.left;
				break;
			case "MemberExpression":
				node = node.object;
				break;
			case "CallExpression":
				node = node.callee;
				break;
			case "TaggedTemplateExpression":
				node = node.tag;
				break;
			case "SequenceExpression":
				node = node.expressions[0];
				break;
			case "ConditionalExpression":
				node = node.test;
				break;
			case "ChainExpression":
				node = node.expression;
				break;
			case "UpdateExpression":
				if (node.prefix) return node.range[0];
				node = node.argument;
				break;
			default:
				return node.range[0];
		}
	}
}

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

function closeOfJsx(text, node) {
	// What Bun's tree has: the `/` of a self-closing tag, or the name of the closing tag.
	let at;
	if (node.type === "JSXFragment") at = node.closingFragment.range[1] - 1;
	else if (node.closingElement) at = node.closingElement.name.range[0];
	else at = text.lastIndexOf("/", node.range[1] - 1);
	for (let i = at; i < text.length; i++) {
		if (text[i] === "/" && text[i + 1] === "*") {
			i = text.indexOf("*/", i + 2) + 1;
			continue;
		}
		if (text[i] === "/" && text[i + 1] === "/") {
			while (i < text.length && !isLineTerminator(text, i)) i++;
			continue;
		}
		if (text[i] === ">") return i + 1;
	}
	return -1;
}

function verdicts(code, sourceType) {
	const ast = espree.parse(code, {
		ecmaVersion: "latest",
		sourceType,
		range: true,
		ecmaFeatures: { jsx: true },
	});
	const out = [];
	walk(ast, node => {
		if (
			node.type === "BinaryExpression" &&
			(node.operator === "in" || node.operator === "instanceof") &&
			node.left.type === "UnaryExpression" &&
			node.left.operator === "!"
		) {
			const regexes = new Map();
			const jsx = new Map();
			walk(node.left.argument, inner => {
				if (inner.type === "Literal" && inner.regex) {
					regexes.set(inner.range[0], inner.range[1] - inner.range[0]);
				}
				if (inner.type === "JSXElement" || inner.type === "JSXFragment") {
					const end = closeOfJsx(code, inner);
					if (end !== inner.range[1]) throw new Error("jsx end differs: " + code);
					jsx.set(inner.range[0], end);
				}
			});
			const result = scan(code, node.left.range[0] + 1, leftmost(node.right), regexes, jsx);
			out.push({ at: node.left.range[0], result, leftEnd: node.left.range[1] });
		}
	});
	return out;
}

const linter = new Linter();
function eslintReports(code, sourceType) {
	const msgs = linter.verify(
		code,
		[
			{
				languageOptions: {
					ecmaVersion: "latest",
					sourceType,
					parserOptions: { ecmaFeatures: { jsx: true }, range: true },
				},
				rules: { "no-unsafe-negation": "error" },
			},
		],
		{ filename: "x.js" },
	);
	if (msgs.some(m => m.fatal)) return null;
	return msgs;
}

function offsetOf(code, line, column) {
	const lines = code.split(/\r\n|[\n\r\u2028\u2029]/u);
	// Only used with "\n" separated cases.
	let offset = 0;
	for (let i = 0; i < line - 1; i++) offset += lines[i].length + 1;
	return offset + column - 1;
}

module.exports = { scan, verdicts, eslintReports, offsetOf };

if (require.main === module) {
	const [sourceType, file] = process.argv.slice(2);
	const cases = fs.readFileSync(file, "utf8").split(/^----\n/m);
	let checked = 0;
	let candidates = 0;
	let bad = 0;
	for (const raw of cases) {
		const code = raw.replace(/\n$/, "");
		if (code === "") continue;
		const msgs = eslintReports(code, sourceType);
		if (msgs === null) {
			console.log("SKIP (does not parse) " + JSON.stringify(code));
			continue;
		}
		checked++;
		const reported = new Map(msgs.map(m => [offsetOf(code, m.line, m.column), m]));
		for (const v of verdicts(code, sourceType)) {
			candidates++;
			const expected = reported.has(v.at);
			if (v.result.unknown) {
				bad++;
				console.log(`UNKNOWN ${v.result.unknown} ` + JSON.stringify(code));
				continue;
			}
			const mine = !v.result.parenthesised;
			if (mine !== expected) {
				bad++;
				console.log(`MISMATCH eslint=${expected} scan=${mine} ` + JSON.stringify(code));
			}
			reported.delete(v.at);
		}
		for (const m of reported.values()) {
			bad++;
			console.log("MISSED " + m.line + ":" + m.column + " " + JSON.stringify(code));
		}
	}
	console.log(`${checked} cases, ${candidates} candidates, ${bad} disagreements`);
}
