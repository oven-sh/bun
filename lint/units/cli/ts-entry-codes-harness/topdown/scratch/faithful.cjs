// scratch: does the oracle configuration reproduce what ESLint's own test expects of each case (valid: no report, invalid: a report)?
"use strict";
const path = require("path");
const { execFileSync } = require("child_process");
const P = "/workspace/notes/lint/units/cli/round2-oracle/proto-1b";
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const tsParser = require("module").createRequire("/workspace/ref/tseslint/")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const ALL = require(path.join(P, "recommended.cjs"));
const isTs = e => /^[cm]?tsx?$/.test(e);
function run(code, rule, sourceType, ext) {
	const jsx = ext === "jsx" || ext === "tsx";
	const languageOptions = { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } };
	if (isTs(ext)) languageOptions.parser = tsParser;
	const m = linter.verify(code, [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { [rule]: "error" } }], { filename: `c.${ext}` });
	return m.find(x => x.fatal) ? null : m.length;
}
let total = 0, bad = 0;
for (const rule of ALL) {
	const out = JSON.parse(execFileSync(process.execPath, [path.join(P, "extract.cjs"), rule], { encoding: "utf8", maxBuffer: 1 << 28 }));
	const wrong = [];
	for (const c of out.cases) {
		const ts = isTs(c.ext), jsx = c.ext === "jsx" || c.ext === "tsx";
		const own = run(c.code, rule, c.sourceType || "module", c.ext);
		total++;
		if (own === null) continue;
		if ((c.kind === "valid") !== (own === 0)) wrong.push(`${c.kind} but ${own} report(s) [${c.sourceType || "module"}]: ${JSON.stringify(c.code).slice(0, 90)}`);
	}
	bad += wrong.length;
	if (wrong.length) { console.log(`${rule}: ${wrong.length} of ${out.cases.length} cases where the oracle run is not what the test expects`); for (const w of wrong.slice(0, 4)) console.log("     " + w); }
}
console.log(`total ${total} cases, ${bad} where the oracle run is not what ESLint's test expects`);
