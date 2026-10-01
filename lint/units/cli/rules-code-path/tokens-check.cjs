// Research scratch (rules-code-path): the two forward reads of tokens that the rules need where Bun's tree has no
// place, checked against the nodes of ESLint's tree (espree, and typescript-eslint's parser for TypeScript):
//   1. where a property of an object literal starts: the first token after the last `,` of the object's own level
//      (or after its `{`) that stands before the key;
//   2. where a `default` clause starts: the first `default` at the level of the clause before it (read from the last
//      statement of that clause, else from its test, else from the `{` of the `switch`) that no `.` or `?.` precedes;
//   3. where a `case` clause starts: the token before the test (before the `(` around it) is `case`.
// usage: node tokens-check.cjs [--cases corpus.json] [--files list.txt] [--list cases.json]
"use strict";
const fs = require("fs");
const path = require("path");
const ESLINT = "/workspace/ref/eslint";
const { Linter } = require(path.join(ESLINT, "lib/linter"));
const tsParser = require("module").createRequire("/workspace/ref/tseslint/")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });

const count = { sources: 0, rejected: 0, properties: 0, propertiesScanned: 0, propertyDiffers: 0, defaults: 0, defaultDiffers: 0, cases: 0, caseDiffers: 0, colons: 0, colonDiffers: 0, uniform: 0, uniformDiffers: 0 };
let shown = 0;
const show = (what, source, at) => { if (shown++ < 25) console.log(`${what} at ${at}: ${JSON.stringify(source.slice(Math.max(0, at - 40), at + 40))}`); };

function check(source, ts, jsx) {
	let ast = null, sourceCode = null;
	const grab = { create: context => ({ Program(node) { ast = node; sourceCode = context.sourceCode; } }) };
	let messages = null;
	for (const sourceType of ts ? ["module"] : ["module", "commonjs", "script"]) {
		const languageOptions = ts ? { parser: tsParser, sourceType, parserOptions: { ecmaFeatures: { jsx } } } : { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: true } } };
		ast = null;
		messages = linter.verify(source, [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], plugins: { t: { rules: { grab } } }, languageOptions, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { "t/grab": 2 } }], { filename: ts ? (jsx ? "c.tsx" : "c.ts") : "c.js" });
		if (!messages.some(m => m.fatal)) break;
	}
	if (!ast || messages.some(m => m.fatal)) { count.rejected++; return; }
	count.sources++;
	const tokens = sourceCode.ast.tokens;
	const indexAt = at => { let lo = 0, hi = tokens.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (tokens[mid].range[0] < at) lo = mid + 1; else hi = mid; } return lo; };
	// +1, -1 or 0: what a token does to the bracket level. A piece of template text opens with `${` and closes with `}`.
	const level = t => {
		if (t.type === "Template") return (t.value.endsWith("${") ? 1 : 0) - (t.value.startsWith("}") ? 1 : 0);
		if (t.type !== "Punctuator") return 0;
		return "([{".includes(t.value) && t.value.length === 1 ? 1 : ")]}".includes(t.value) && t.value.length === 1 ? -1 : 0;
	};
	const visitorKeys = sourceCode.visitorKeys;
	const todo = [ast];
	while (todo.length) {
		const node = todo.pop();
		const keys = visitorKeys[node.type] || [];
		for (const k of keys) {
			const child = node[k];
			if (Array.isArray(child)) { for (const c of child) if (c && typeof c.type === "string") todo.push(c); } else if (child && typeof child.type === "string") todo.push(child);
		}
		if (node.type === "ObjectExpression") {
			const wanted = node.properties.filter(p => p.type === "Property").map(p => ({ p, key: p.key.range[0] }));
			count.properties += wanted.length;
			// Only a property that does not start with its key needs the read.
			if (!wanted.some(w => w.p.range[0] !== w.key || w.p.computed)) continue;
			let i = indexAt(node.range[0]) + 1;
			let depth = 0, candidate = null, next = 0, afterComma = true;
			for (; i < tokens.length && next < wanted.length; i++) {
				const t = tokens[i];
				if (afterComma && depth === 0) { candidate = t.range[0]; afterComma = false; }
				// A computed key stands inside `[` and maybe `(`: the first token at or after the place of the key ends the search.
				while (next < wanted.length && t.range[0] >= wanted[next].key) {
					count.propertiesScanned++;
					if (candidate !== wanted[next].p.range[0]) { count.propertyDiffers++; show("PROPERTY", source, wanted[next].p.range[0]); }
					next++;
				}
				const d = level(t);
				if (depth === 0 && t.type === "Punctuator" && t.value === ",") afterComma = true;
				depth += d;
				if (depth < 0) break;
			}
		} else if (node.type === "SwitchStatement") {
			node.cases.forEach((c, index) => {
				// From where the read starts.
				let from;
				if (index === 0) from = null;
				else {
					const before = node.cases[index - 1];
					from = before.consequent.length ? before.consequent.at(-1).range[0] : before.test ? before.test.range[0] : before.range[0];
				}
				let i;
				if (from === null) {
					// The `{` of the statement: the first `{` after the discriminant and its `)`.
					i = indexAt(node.discriminant.range[1]);
					while (tokens[i].value !== "{") i++;
					i++;
				} else i = indexAt(from);
				if (c.test === null) {
					count.defaults++;
					let depth = 0, found = null;
					for (; i < tokens.length; i++) {
						const t = tokens[i];
						if (depth === 0 && t.type === "Keyword" && t.value === "default" && !(i > 0 && (tokens[i - 1].value === "." || tokens[i - 1].value === "?."))) { found = t.range[0]; break; }
						depth += level(t);
						if (depth < 0) break;
					}
					if (found !== c.range[0]) { count.defaultDiffers++; show("DEFAULT", source, c.range[0]); }
				} else {
					count.cases++;
					// The token before the test, before every `(` around it.
					let k = indexAt(c.test.range[0]) - 1;
					while (k >= 0 && tokens[k].value === "(" && tokens[k].type === "Punctuator") k--;
					if (!(k >= 0 && tokens[k].type === "Keyword" && tokens[k].value === "case" && tokens[k].range[0] === c.range[0])) { count.caseDiffers++; show("CASE", source, c.range[0]); }
				}
				// One rule for both words, as the probe has it: after a clause with statements, the first `case` or `default` at the
				// level of the clause, read from its last statement, that no `.` or `?.` precedes; after an empty one, the token after its `:`.
				if (index > 0) {
					count.uniform++;
					const before = node.cases[index - 1];
					let found = null;
					if (before.consequent.length) {
						let depth = 0;
						for (let j = indexAt(before.consequent.at(-1).range[0]); j < tokens.length; j++) {
							const t = tokens[j];
							if (depth === 0 && t.type === "Keyword" && (t.value === "default" || t.value === "case") && !(j > 0 && (tokens[j - 1].value === "." || tokens[j - 1].value === "?."))) { found = t.range[0]; break; }
							depth += level(t);
							if (depth < 0) break;
						}
					} else {
						// The clause before is empty: its `:` is its last token.
						const j = indexAt(before.range[1]);
						found = tokens[j] ? tokens[j].range[0] : null;
					}
					if (found !== c.range[0]) { count.uniformDiffers++; show("UNIFORM", source, c.range[0]); }
				}
				// The `:` of the clause: after the test and every `)` around it; after `default`.
				count.colons++;
				let k = c.test ? indexAt(c.test.range[1]) : indexAt(c.range[0]) + 1;
				while (k < tokens.length && tokens[k].value === ")" && tokens[k].type === "Punctuator") k++;
				const colon = tokens[k];
				const expectedEnd = c.consequent.length ? null : c.range[1];
				if (!colon || colon.value !== ":" || (expectedEnd !== null && colon.range[1] !== expectedEnd)) { count.colonDiffers++; show("COLON", source, c.range[0]); }
			});
		}
	}
}

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--cases") for (const c of JSON.parse(fs.readFileSync(args[++i], "utf8"))) check(c.code, c.kind === "ts", !!c.jsx);
	else if (args[i] === "--list") for (const raw of JSON.parse(fs.readFileSync(args[++i], "utf8"))) { const c = typeof raw === "string" ? { code: raw, ext: "js" } : raw; check(c.code, /^[mc]?ts/u.test(c.ext || "js"), c.ext === "tsx" || c.ext === "jsx"); }
	else if (args[i] === "--files") for (const f of fs.readFileSync(args[++i], "utf8").split("\n").filter(Boolean)) { try { check(fs.readFileSync(f, "utf8"), /\.[mc]?tsx?$/u.test(f), /x$/u.test(f)); } catch (e) { if (!/ENOENT|EISDIR/u.test(String(e))) throw e; } }
}
console.log(JSON.stringify(count));
