// scratch: for the cases of ESLint's own test of each recommended rule (default options), which extension carries the case:
// the first extension whose source type gives the answer that ESLint gives under the source type of the case.
"use strict";
const path = require("path");
const { execFileSync } = require("child_process");
const P = "/workspace/notes/lint/units/cli/round2-oracle/proto-1b";
const ESLINT = "/workspace/ref/eslint";
const { Linter } = require(path.join(ESLINT, "lib/linter"));
const tsParser = require("module").createRequire("/workspace/ref/tseslint/")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const ALL = require(path.join(P, "recommended.cjs"));
const isTs = e => /^[cm]?tsx?$/.test(e);
function run(code, rule, sourceType, ext) {
	const jsx = ext === "jsx" || ext === "tsx";
	const languageOptions = { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } };
	if (isTs(ext)) languageOptions.parser = tsParser;
	const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { [rule]: "error" } }];
	const m = linter.verify(code, config, { filename: `c.${ext}` });
	const fatal = m.find(x => x.fatal);
	return fatal ? "FATAL" : JSON.stringify(m.map(x => `${x.line}:${x.column} ${x.message}`).sort());
}
const rules = process.argv.length > 2 ? process.argv.slice(2) : ALL;
const total = {};
for (const rule of rules) {
	let out;
	try { out = JSON.parse(execFileSync(process.execPath, [path.join(P, "extract.cjs"), rule], { encoding: "utf8", maxBuffer: 1 << 28 })); } catch (e) { console.log(rule, "EXTRACT FAILED", String(e.message).split("\n")[0]); continue; }
	const t = {};
	const inc = k => { t[k] = (t[k] || 0) + 1; total[k] = (total[k] || 0) + 1; };
	const ex = {};
	for (const c of out.cases) {
		const ts = isTs(c.ext), jsx = c.ext === "jsx" || c.ext === "tsx";
		const stated = c.sourceType || "module";
		// the answer of the case as ESLint's test runs it
		const own = run(c.code, rule, stated, c.ext);
		const modExt = c.ext === "cjs" || c.ext === "cts" ? (ts ? "ts" : "js") : c.ext;
		const cjsExt = ts ? "cts" : "cjs";
		const mod = run(c.code, rule, "module", modExt);
		const cjs = jsx ? "NOJSX" : run(c.code, rule, "commonjs", cjsExt);
		let k;
		if (own === "FATAL") k = `${stated}: ESLint rejects as stated`;
		else if (mod === own) k = `${stated} -> ${modExt} (module)`;
		else if (cjs === own) k = `${stated} -> ${cjsExt} (commonjs)`;
		else k = `${stated}: NO EXTENSION (module ${mod === "FATAL" ? "rejects" : "differs"}, commonjs ${cjs === "FATAL" ? "rejects" : cjs === "NOJSX" ? "has no JSX" : "differs"})`;
		inc(k);
		if (k.includes("NO EXTENSION")) (ex[k] = ex[k] || []).push(JSON.stringify(c.code).slice(0, 100));
	}
	console.log(rule.padEnd(34), out.cases.length, JSON.stringify(t));
	for (const [k, l] of Object.entries(ex)) for (const e of l.slice(0, 3)) console.log("      e.g. " + e);
}
console.log("TOTAL", JSON.stringify(total, null, 1));
