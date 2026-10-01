// Writes the expected reports of a rule for a list of snippets: ESLint at the pin, and what the prototype gives.
// usage: node make-vectors.cjs <no-duplicate-case|no-self-assign> <out.json> <in.json>...
"use strict";
const path = require("path");
const fs = require("fs");
const { Linter } = require(path.join(__dirname, "eslint-pin/lib/linter"));
const rule = process.argv[2];
const out = process.argv[3];
const proto = rule === "no-duplicate-case" ? require("./dc-diff.cjs") : require("./sa-diff.cjs");
const linter = new Linter({ configType: "flat" });
const seen = new Set();
const vectors = [];
let differ = 0;

function lineCol(code, utf16Index) {
	let line = 1;
	let col = 1;
	for (let i = 0; i < utf16Index; i++) {
		const ch = code[i];
		if (ch === "\r" && code[i + 1] === "\n") continue;
		if (ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029") {
			line += 1;
			col = 1;
		} else col += 1;
	}
	return [line, col];
}

for (const f of process.argv.slice(4)) {
	for (const c of JSON.parse(fs.readFileSync(f, "utf8"))) {
		const code = typeof c === "string" ? c : c.code;
		const jsx = typeof c === "object" && !!c.jsx;
		if (seen.has(code)) continue;
		seen.add(code);
		const messages = linter.verify(code, [
			{
				languageOptions: { ecmaVersion: "latest", sourceType: "script", parserOptions: { ecmaFeatures: { jsx } } },
				rules: { [rule]: "error" },
			},
		]);
		if (messages.some(m => m.fatal)) continue;
		const eslint = messages.map(m => ({ line: m.line, column: m.column, endLine: m.endLine, endColumn: m.endColumn, message: m.message }));
		let mine;
		try {
			mine = proto.mine(code, rule === "no-duplicate-case" ? jsx : { sourceType: "script" });
		} catch (e) {
			if (!jsx) throw e;
			mine = null;
		}
		// byte offset -> UTF-16 index
		const back = new Map();
		if (mine) mine.at.forEach((b, i) => { if (!back.has(b)) back.set(b, i); });
		let expect;
		if (mine === null) expect = null;
		else if (rule === "no-duplicate-case") {
			expect = mine.reports
				.filter(r => r.start !== undefined)
				.sort((a, b) => a.start - b.start)
				.map(r => {
					const [line, column] = lineCol(code, back.get(r.start));
					return { line, column, start: r.start, length: r.len, message: "Duplicate case label." };
				});
		} else {
			const sorted = mine.reports.slice().sort((a, b) => a.start - b.start);
			expect = [];
			for (const r of sorted) {
				const [line, column] = lineCol(code, back.get(r.start));
				const e = { line, column, start: r.start, length: r.len, message: `'${r.name}' is assigned to itself.` };
				const last = expect[expect.length - 1];
				// The printer prints one of two equal diagnostics.
				if (last && last.start === e.start && last.message === e.message) continue;
				expect.push(e);
			}
		}
		const v = { code, eslint, expect };
		if (jsx) v.jsx = true;
		// Same starts and messages as ESLint, apart from the merged duplicates.
		if (expect !== null) {
			const a = [...new Set(eslint.map(m => `${m.line}:${m.column} ${m.message}`))].sort();
			const b = expect.map(m => `${m.line}:${m.column} ${m.message}`).sort();
			if (JSON.stringify(a) !== JSON.stringify(b)) {
				v.differs = true;
				differ += 1;
			}
		}
		vectors.push(v);
	}
}
fs.writeFileSync(out, JSON.stringify(vectors, null, 1));
console.log(`${rule}: ${vectors.length} vectors, ${vectors.filter(v => v.eslint.length).length} with reports, ${differ} where the prototype and ESLint differ`);
