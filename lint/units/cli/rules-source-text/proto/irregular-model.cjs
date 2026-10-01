// Research scratch: the model of no-irregular-whitespace that the plan for Bun rests on, checked against ESLint at the pin.
// Model: one report at the first character of each run of irregular blanks and at each U+2028 / U+2029, unless that place
// is inside a string token. usage: node irregular-model.cjs <answers.jsonl>...
"use strict";
const fs = require("fs");
const espree = require("/workspace/ref/eslint/node_modules/espree");
const tsParser = require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
const RUN = /[\f\v\u0085\ufeff\u00a0\u1680\u180e\u2000-\u200b\u202f\u205f\u3000]+|[\u2028\u2029]/gu;
let total = 0, wrong = 0, skipped = 0;
for (const file of process.argv.slice(2)) {
	for (const c of fs.readFileSync(file, "utf8").trim().split("\n").map(l => JSON.parse(l))) {
		if (c.fatal) { skipped++; continue; }
		const text = c.code.replace(/^\ufeff/, "");
		const bom = text.length !== c.code.length;
		let tokens;
		try {
			tokens = c.type === "ts" || c.type === "tsx"
				? tsParser.parseForESLint(text, { range: true, tokens: true, ecmaFeatures: { jsx: c.type === "tsx" }, filePath: c.type === "tsx" ? "a.tsx" : "a.ts" }).ast.tokens
				: espree.parse(text, { ecmaVersion: "latest", sourceType: c.type, ecmaFeatures: { jsx: !!c.jsx }, range: true, tokens: true }).tokens;
		} catch (e) { skipped++; continue; }
		// A string in a JSX attribute is a token of the type JSXText that follows `=`: for Bun the tree gives it (an E::EString at its quote).
		const strings = tokens.filter((t, i) => t.type === "String" || (t.type === "JSXText" && i > 0 && tokens[i - 1].value === "=" && /^["']/.test(t.value))).map(t => t.range);
		// Line and column of an index, with ESLint's line breaks.
		const starts = [0];
		for (const m of text.matchAll(/\r\n|[\r\n\u2028\u2029]/gu)) starts.push(m.index + m[0].length);
		const at = i => { let l = 0; while (l + 1 < starts.length && starts[l + 1] <= i) l++; return `${l + 1}:${i - starts[l] + 1}`; };
		const model = [];
		for (const m of text.matchAll(RUN)) if (!strings.some(([s, e]) => s <= m.index && m.index < e)) model.push(at(m.index));
		const eslint = c.options ? null : c.reports.map(r => r.split("-")[0]);
		if (eslint === null) { skipped++; continue; }
		total++;
		if (JSON.stringify(model) !== JSON.stringify(eslint) || bom && false) {
			wrong++;
			console.log("DIFFERS", JSON.stringify(c.code), "model", model.join(" "), "eslint", eslint.join(" "));
		}
	}
}
console.log(`cases ${total}, wrong ${wrong}, skipped (options, or a parser rejects) ${skipped}`);
