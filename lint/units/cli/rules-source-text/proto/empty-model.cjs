// Research scratch: the plan for no-empty and no-empty-static-block on Bun's tree, as ESLint rules, compared with the real rules.
// The model never asks how many statements a block has (Bun's tree drops `;`, "use strict" and erased TypeScript statements)
// and never asks for comments: a block is reported when the text between its braces is blank.
// usage: node empty-model.cjs <answers.jsonl>...
"use strict";
const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const tsParser = require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
// ECMAScript WhiteSpace and LineTerminator, as Bun's lexer skips them.
const BLANK = /^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/u;
const isFunction = n => n && /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type);
const model = {
	meta: { type: "suggestion", schema: [], messages: { block: "Empty block statement.", switch: "Empty switch statement.", static: "Unexpected empty static block." } },
	create(context) {
		const text = context.sourceCode.text;
		// Context::braces_are_blank: from the `{` at `open`, only blanks up to a `}`.
		const blank = open => {
			const close = text.indexOf("}", open + 1);
			return close >= 0 && BLANK.test(text.slice(open + 1, close));
		};
		const at = (node, open, messageId) => context.report({ node, loc: { start: context.sourceCode.getLocFromIndex(open), end: context.sourceCode.getLocFromIndex(open + 1) }, messageId });
		return {
			BlockStatement(node) {
				if (isFunction(node.parent)) return;
				if (blank(node.range[0])) at(node, node.range[0], "block");
			},
			SwitchStatement(node) {
				// S::Switch::body_loc: the `{` after the `)` of the discriminant.
				const open = context.sourceCode.getTokenAfter(node.discriminant, t => t.value === "{").range[0];
				if (node.cases.length === 0 && blank(open)) at(node, open, "switch");
			},
			StaticBlock(node) {
				// G::ClassStaticBlock::loc: the `{`.
				const open = context.sourceCode.getFirstToken(node, t => t.value === "{").range[0];
				if (blank(open)) at(node, open, "static");
			},
		};
	},
};
const plugin = { rules: { model } };
let total = 0, wrong = 0, fatal = 0, reports = 0;
for (const file of process.argv.slice(2)) {
	for (const c of fs.readFileSync(file, "utf8").trim().split("\n").map(l => JSON.parse(l))) {
		const ts = c.type === "ts" || c.type === "tsx";
		const rules = { "m/model": "error", "no-empty": "error", "no-empty-static-block": "error" };
		const config = ts
			? [{ files: ["**/*.ts", "**/*.tsx"], plugins: { m: plugin }, languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: c.type === "tsx" } } }, rules }]
			: [{ plugins: { m: plugin }, languageOptions: { ecmaVersion: "latest", sourceType: c.type, parserOptions: { ecmaFeatures: { jsx: !!c.jsx } } }, rules }];
		const messages = linter.verify(c.code, config, { allowInlineConfig: false, reportUnusedDisableDirectives: false, ...(ts ? { filename: c.type === "tsx" ? "a.tsx" : "a.ts" } : {}) });
		if (messages.some(m => m.fatal)) { fatal++; continue; }
		total++;
		const key = m => `${m.line}:${m.column} ${m.message}`;
		const theirs = messages.filter(m => m.ruleId !== "m/model").map(key).sort();
		const ours = messages.filter(m => m.ruleId === "m/model").map(key).sort();
		reports += theirs.length;
		if (JSON.stringify(theirs) !== JSON.stringify(ours)) {
			wrong++;
			if (wrong <= 30) console.log("DIFFERS", c.file || JSON.stringify(c.code), "\n   eslint:", theirs.join(" | ") || "(none)", "\n   model: ", ours.join(" | ") || "(none)");
		}
	}
}
console.log(`cases ${total}, reports of ESLint ${reports}, wrong ${wrong}, rejected by the parser ${fatal}`);
