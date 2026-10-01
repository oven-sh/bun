// Research scratch (rules-code-path): the read back from the key of a class member over blanks for the words that can
// stand before it (what the lint side does until a lint parse has a reader for the start of a class member), against
// the start of ESLint's node. Getters and constructors of classes.
// usage: node member-start-check.cjs [--cases corpus.json] [--files list.txt] [--list cases.json]
"use strict";
const fs = require("fs");
const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const tsParser = require("module").createRequire("/workspace/ref/tseslint/")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const WORDS = ["get", "set", "static", "async", "accessor", "public", "private", "protected", "readonly", "override", "abstract", "declare"];
const count = { sources: 0, rejected: 0, getters: 0, getterSame: 0, constructors: 0, constructorSame: 0 };
let shown = 0;
function backRead(text, key, computed) {
	let at = key;
	const blanks = () => { while (at > 0 && " \t\n\r".includes(text[at - 1])) at--; };
	if (computed) {
		for (;;) { blanks(); if (at > 0 && text[at - 1] === "(") at--; else break; }
		if (at > 0 && text[at - 1] === "[") at--; else return key;
	}
	for (;;) {
		const before = at;
		blanks();
		if (at > 0 && text[at - 1] === "*") { at--; continue; }
		const word = WORDS.find(w => text.slice(Math.max(0, at - w.length), at) === w && !/[\w$#\\]/u.test(text[at - w.length - 1] || " "));
		if (!word) { at = before; break; }
		at -= word.length;
	}
	return at;
}
function check(source, ts, jsx) {
	let ast = null, visitorKeys = null;
	const grab = { create: context => ({ Program(node) { ast = node; visitorKeys = context.sourceCode.visitorKeys; } }) };
	let messages = null;
	for (const sourceType of ts ? ["module"] : ["module", "commonjs", "script"]) {
		const languageOptions = ts ? { parser: tsParser, sourceType, parserOptions: { ecmaFeatures: { jsx } } } : { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: true } } };
		ast = null;
		messages = linter.verify(source, [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], plugins: { t: { rules: { grab } } }, languageOptions, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { "t/grab": 2 } }], { filename: ts ? (jsx ? "c.tsx" : "c.ts") : "c.js" });
		if (!messages.some(m => m.fatal)) break;
	}
	if (!ast || messages.some(m => m.fatal)) { count.rejected++; return; }
	count.sources++;
	const todo = [ast];
	while (todo.length) {
		const node = todo.pop();
		for (const k of visitorKeys[node.type] || []) {
			const child = node[k];
			if (Array.isArray(child)) { for (const c of child) if (c && typeof c.type === "string") todo.push(c); } else if (child && typeof child.type === "string") todo.push(child);
		}
		if (node.type !== "MethodDefinition" || node.value.type !== "FunctionExpression") continue;
		if (node.kind !== "get" && node.kind !== "constructor") continue;
		const found = backRead(source, node.key.range[0], node.computed);
		const same = found === node.range[0];
		if (node.kind === "get") { count.getters++; if (same) count.getterSame++; } else { count.constructors++; if (same) count.constructorSame++; }
		if (!same && shown++ < 12) console.log(`${ts ? "ts" : "js"} ${node.kind}: ${JSON.stringify(source.slice(Math.max(0, node.range[0] - 10), node.key.range[1] + 5))}`);
	}
}
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--cases") for (const c of JSON.parse(fs.readFileSync(args[++i], "utf8"))) check(c.code, c.kind === "ts", !!c.jsx);
	else if (args[i] === "--list") for (const raw of JSON.parse(fs.readFileSync(args[++i], "utf8"))) { const c = typeof raw === "string" ? { code: raw, ext: "js" } : raw; check(c.code, /^[mc]?ts/u.test(c.ext || "js"), c.ext === "tsx" || c.ext === "jsx"); }
	else if (args[i] === "--files") for (const f of fs.readFileSync(args[++i], "utf8").split("\n").filter(Boolean)) { try { check(fs.readFileSync(f, "utf8"), /\.[mc]?tsx?$/u.test(f), /x$/u.test(f)); } catch (e) { if (!/ENOENT|EISDIR/u.test(String(e))) throw e; } }
}
console.log(JSON.stringify(count));
