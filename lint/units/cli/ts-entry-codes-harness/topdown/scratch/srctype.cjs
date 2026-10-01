// scratch: for every case of the fixtures, ESLint's answer for the rule under module, commonjs and script
"use strict";
const fs = require("fs"), path = require("path");
const ESLINT = "/workspace/ref/eslint";
const { Linter } = require(path.join(ESLINT, "lib/linter"));
const linter = new Linter({ configType: "flat" });
const dir = "/workspace/wt/cli/test/cli/lint/rules";
function run(code, rule, sourceType, jsx, ext) {
	const config = [{ files: ["**/*.{js,jsx,mjs,cjs}"], languageOptions: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { [rule]: "error" } }];
	const m = linter.verify(code, config, { filename: `c.${ext}` });
	const fatal = m.find(x => x.fatal);
	return fatal ? "FATAL " + fatal.message : JSON.stringify(m.map(x => `${x.line}:${x.column} ${x.message}`).sort());
}
const tally = {};
const inc = k => (tally[k] = (tally[k] || 0) + 1);
const examples = {};
for (const f of fs.readdirSync(dir).sort()) {
	const rule = f.slice(0, -5);
	for (const c of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) {
		const jsx = !!c.jsx;
		const mod = run(c.code, rule, "module", jsx, jsx ? "jsx" : "js");
		const cjs = run(c.code, rule, "commonjs", jsx, jsx ? "jsx" : "cjs");
		const scr = run(c.code, rule, "script", jsx, jsx ? "jsx" : "js");
		let k;
		if (!mod.startsWith("FATAL")) k = mod === scr || scr.startsWith("FATAL") ? "module parses" + (scr.startsWith("FATAL") ? " (script does not)" : "") : "module and script DIFFER";
		else if (!cjs.startsWith("FATAL")) k = (jsx ? "jsx: " : "") + "only commonjs/script parses" + (cjs === scr ? "" : " AND commonjs differs from script");
		else if (!scr.startsWith("FATAL")) k = "only script parses";
		else k = "none parses";
		inc(k);
		if (k !== "module parses") (examples[k] = examples[k] || []).push(`${rule}: ${JSON.stringify(c.code)} :: ${mod.slice(0, 70)}`);
		// the recorded answer against the module answer
		const want = JSON.stringify((c.differs ? c.eslint : c.expect).map(x => `${x.line}:${x.column} ${x.message}`).sort());
		const wantSet = JSON.stringify([...new Set(JSON.parse(want))]);
		const got = k.startsWith("module") ? mod : cjs.startsWith("FATAL") ? scr : cjs;
		const gotSet = got.startsWith("FATAL") ? got : JSON.stringify([...new Set(JSON.parse(got))]);
		if (wantSet !== gotSet) inc("recorded answer is not the one of the new mapping");
	}
}
console.log(tally);
for (const [k, list] of Object.entries(examples)) { console.log(`\n${k}: ${list.length}`); for (const e of list.slice(0, 12)) console.log("   " + e); }
