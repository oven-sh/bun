// Research scratch: the plan for no-unexpected-multiline on Bun's tree, written as an ESLint rule and compared with the real rule.
// It reads only what Bun's tree and text give: the place of the first own token of a node (a parenthesis is no part of a node),
// the source text, and, where the quick look at the text cannot answer, the tokens from the first token of the operand on.
// usage: node multiline-model.cjs <answers.jsonl>...   prints the cases where the model and ESLint differ, and how often each path ran.
"use strict";
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const tsParser = require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
const real = require("/workspace/ref/eslint/lib/rules/no-unexpected-multiline");
const linter = new Linter({ configType: "flat" });
const paths = { fastOpen: 0, exactOpen: 0, fastGap: 0, exactGap: 0 };

const isBlank = ch => ch === " " || ch === "\t";
const isBreak = ch => ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029";
const isSpace = ch => /[\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]/u.test(ch);

// tokens::gap_before: back from `at` over blanks. "break", "none", or "comment" (a block comment ends there: not known).
function gapBefore(text, at) {
	let i = at;
	for (;;) {
		if (i === 0) return "none";
		const ch = text[i - 1];
		if (isBreak(ch)) return "break";
		if (isSpace(ch)) { i--; continue; }
		if (ch === "/" && text[i - 2] === "*") return "comment";
		return "none";
	}
}
// tokens::opener_back: the `[` or the first `(` of the run that stands right before `to`, over spaces, tabs and `(`, and over
// a line break when the line before it has no `/` and no `-->`: such a line has no comment, so what ends it is code.
function openerBack(text, to, open) {
	let at = to, leftmost = -1;
	for (;;) {
		if (at === 0) return -1;
		const ch = text[at - 1];
		if (isBlank(ch)) at--;
		else if (ch === "(") { at--; leftmost = at; }
		else if (ch === "[" && open === "[") return at - 1;
		else if (ch === "\n" || ch === "\r") {
			let end = at - 1;
			if (ch === "\n" && text[end - 1] === "\r") end--;
			let start = end;
			while (start > 0 && text[start - 1] !== "\n" && text[start - 1] !== "\r") start--;
			const line = text.slice(start, end);
			if (line.includes("/") || line.includes("-->") || /[^\x00-\x7f]/.test(line)) return -1;
			at = end;
		} else break;
	}
	if (open !== "(" || leftmost < 0 || at === 0) return -1;
	const stop = text[at - 1];
	// A comment may stand before the run: the run may go on behind it.
	if ((stop === "/" && text[at - 2] === "*") || stop.charCodeAt(0) >= 0x80) return -1;
	return leftmost;
}

const model = {
	meta: { type: "problem", schema: [], messages: real.meta.messages },
	create(context) {
		const sourceCode = context.sourceCode;
		const text = sourceCode.text;
		// The tokens from `from` on, as Bun's lexer would give them: no comments.
		const tokensFrom = from => sourceCode.ast.tokens.filter(t => t.range[0] >= from);
		// Context::opener, the exact way: the bracket that raised the depth from 0 and is open at `to`.
		function openerExact(from, to, open) {
			let depth = 0, opener = null;
			for (const t of tokensFrom(from)) {
				if (t.range[0] >= to) return t.range[0] === to && opener && opener.value === open ? opener.range[0] : -1;
				if (t.type !== "Punctuator") continue;
				if ("([{".includes(t.value) || t.value === "${") { if (depth === 0) opener = t; depth++; }
				else if (")]}".includes(t.value) && depth > 0) { depth--; if (depth === 0) opener = null; }
			}
			return -1;
		}
		function opener(from, to, open) {
			const quick = openerBack(text, to, open);
			if (quick >= 0) { paths.fastOpen++; return quick; }
			paths.exactOpen++;
			return openerExact(from, to, open);
		}
		// Context::line_break_before.
		function breakBefore(from, at) {
			const gap = gapBefore(text, at);
			if (gap !== "comment") { paths.fastGap++; return gap === "break"; }
			paths.exactGap++;
			let prevEnd = -1;
			for (const t of tokensFrom(from)) {
				if (t.range[0] >= at) break;
				prevEnd = t.range[1];
			}
			return prevEnd >= 0 && /[\n\r\u2028\u2029]/u.test(text.slice(prevEnd, at));
		}
		// The place of the first own token of a node: ESTree starts a node at the `(` of its first operand, Bun's tree does not.
		const own = node => {
			let n = node;
			for (;;) {
				if (n.type === "BinaryExpression" || n.type === "LogicalExpression" || n.type === "AssignmentExpression") n = n.left;
				else if (n.type === "MemberExpression") n = n.object;
				else if (n.type === "CallExpression") n = n.callee;
				else if (n.type === "ConditionalExpression") n = n.test;
				else if (n.type === "TaggedTemplateExpression") n = n.tag;
				else if (n.type === "SequenceExpression") n = n.expressions[0];
				else if (n.type === "UpdateExpression" && !n.prefix) n = n.argument;
				else if (n.type === "ChainExpression") n = n.expression;
				else if (n.type === "TSAsExpression" || n.type === "TSSatisfiesExpression" || n.type === "TSNonNullExpression") n = n.expression;
				else if (n.type === "TSTypeAssertion") n = n.expression;
				else if (n.type === "TSInstantiationExpression") n = n.expression;
				else return n.range[0];
			}
		};
		function report(node, at, messageId) {
			context.report({ node, loc: { start: sourceCode.getLocFromIndex(at), end: sourceCode.getLocFromIndex(at + 1) }, messageId });
		}
		return {
			MemberExpression(node) {
				if (!node.computed || node.optional) return;
				const from = own(node.object);
				const at = opener(from, own(node.property), "[");
				if (at >= 0 && breakBefore(from, at)) report(node, at, "property");
			},
			CallExpression(node) {
				if (node.arguments.length === 0 || node.optional) return;
				const from = own(node.callee);
				let at = opener(from, own(node.arguments[0]), "(");
				if (at < 0) return;
				// The side table of a lint parse: the type arguments whose `>` is the token before the `(`.
				if (node.typeArguments) at = node.typeArguments.range[0];
				if (breakBefore(from, at)) report(node, at, "function");
			},
			TaggedTemplateExpression(node) {
				// Bun: the offset of the raw text of the first piece in the source, less one.
				const at = node.quasi.range[0];
				if (breakBefore(own(node.tag), at)) report(node, at, "taggedTemplate");
			},
			BinaryExpression(node) {
				if (node.operator !== "/" || node.left.type !== "BinaryExpression" || node.left.operator !== "/") return;
				const inner = node.left;
				const x = own(node.right);
				if (text[x - 1] !== "/" || text[x - 2] === "*") return;
				// The word at `x`, with its escapes spelled.
				const word = /^(?:[\p{ID_Start}$_]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\})(?:[\p{ID_Continue}$\u200c\u200d]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\})*/u.exec(text.slice(x));
				if (!word) return;
				const spelled = word[0].replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (m, a, b) => String.fromCodePoint(parseInt(a || b, 16)));
				if (!/^[dgimsuvy]+$/u.test(spelled)) return;
				const from = own(inner.left);
				// The `/` of the inner division: back from its right operand over blanks and `(`.
				let at = own(inner.right), found = -1;
				for (;;) {
					const ch = text[at - 1];
					if (isBlank(ch) || ch === "(") at--;
					else { if (ch === "/" && text[at - 2] !== "*") found = at - 1; break; }
				}
				if (found < 0) {
					// The exact way: the last token before the right operand that is no `(`.
					let last = null;
					for (const t of tokensFrom(from)) {
						if (t.range[0] >= own(inner.right)) break;
						if (t.value !== "(") last = t;
					}
					if (!last || last.value !== "/") return;
					found = last.range[0];
					paths.exactOpen++;
				} else paths.fastOpen++;
				if (breakBefore(from, found)) report(node, found, "division");
			},
		};
	},
};

const plugin = { rules: { model } };
let total = 0, wrong = 0, fatal = 0;
for (const file of process.argv.slice(2)) {
	for (const c of fs.readFileSync(file, "utf8").trim().split("\n").map(l => JSON.parse(l))) {
		const ts = c.type === "ts" || c.type === "tsx";
		const config = ts
			? [{ files: ["**/*.ts", "**/*.tsx"], plugins: { m: plugin }, languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: c.type === "tsx" } } }, rules: { "m/model": "error", "no-unexpected-multiline": "error" } }]
			: [{ plugins: { m: plugin }, languageOptions: { ecmaVersion: "latest", sourceType: c.type, parserOptions: { ecmaFeatures: { jsx: !!c.jsx } } }, rules: { "m/model": "error", "no-unexpected-multiline": "error" } }];
		const messages = linter.verify(c.code, config, { allowInlineConfig: false, reportUnusedDisableDirectives: false, ...(ts ? { filename: c.type === "tsx" ? "a.tsx" : "a.ts" } : {}) });
		if (messages.some(m => m.fatal)) { fatal++; continue; }
		total++;
		const key = m => `${m.line}:${m.column} ${m.message}`;
		const theirs = messages.filter(m => m.ruleId === "no-unexpected-multiline").map(key).sort();
		const ours = messages.filter(m => m.ruleId === "m/model").map(key).sort();
		if (JSON.stringify(theirs) !== JSON.stringify(ours)) {
			wrong++;
			console.log("DIFFERS", JSON.stringify(c.code), "\n   eslint:", theirs.join(" | ") || "(none)", "\n   model: ", ours.join(" | ") || "(none)");
		}
	}
}
console.log(`cases ${total}, wrong ${wrong}, rejected by the parser ${fatal}; paths ${JSON.stringify(paths)}`);
