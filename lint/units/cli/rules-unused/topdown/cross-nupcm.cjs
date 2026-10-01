// Research scratch of "rules-unused" (pass 1b): what test/cli/lint/rules.test.ts asks across rules for no-unused-private-class-members.
// (1) the cases of the fixtures of the tree that get a line of this rule from ESLint: they have to be cases of its fixture too
//     -> seed/no-unused-private-class-members.cross.json (with ESLint's answer).
// (2) the cases of seed/no-unused-private-class-members.json that get a line of one of the eleven rules of the tree from ESLint:
//     they have to be added to the fixture of that rule -> printed as a count per rule.
// usage: node cross-nupcm.cjs [fixtures dir, default /workspace/wt/cli/test/cli/lint/rules]
"use strict";
const fs = require("fs");
const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const tsPlugin = req("@typescript-eslint/eslint-plugin");
const linter = new Linter({ configType: "flat" });
const dir = process.argv[2] || "/workspace/wt/cli/test/cli/lint/rules";
const RULE = "no-unused-private-class-members";
function run(code, ext, rules) {
	const isTs = /tsx?$/.test(ext);
	const tries = isTs ? [[ext === "cts" ? "commonjs" : "module", false]] : ext === "mjs" ? [["module", false]] : ext === "cjs" ? [["commonjs", false]] : ext === "jsx" ? [["script", true], ["module", true]] : [["script", false], ["module", false]];
	for (const [sourceType, jsx] of tries) {
		const languageOptions = isTs ? { parser: tsParser, ecmaVersion: "latest", sourceType } : { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } };
		const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions, plugins: { "@typescript-eslint": tsPlugin }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: Object.fromEntries(rules.map(r => [r, "error"])) }];
		const m = linter.verify(code, config, { filename: `c.${ext}` });
		if (m.some(x => x.fatal)) continue;
		return m;
	}
	return null;
}
const extOf = c => c.ext || (c.jsx ? "jsx" : "js");
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "seed/no-unused-private-class-members.json"), "utf8"));
const have = new Set(seed.map(c => `${extOf(c)}:${c.code}`));
const tree = fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
const add = [];
const seen = new Set();
for (const rule of tree) for (const c of JSON.parse(fs.readFileSync(path.join(dir, `${rule}.json`), "utf8"))) {
	const key = `${extOf(c)}:${c.code}`;
	if (seen.has(key) || have.has(key)) continue;
	seen.add(key);
	const m = run(c.code, extOf(c), [RULE]);
	if (!m) continue;
	const expect = m.filter(x => x.ruleId === RULE).map(x => ({ line: x.line, column: x.column, message: x.message }));
	if (expect.length) { const o = { code: c.code }; if (c.jsx) o.jsx = true; if (c.ext) o.ext = c.ext; o.expect = expect; add.push(o); }
}
fs.writeFileSync(path.join(__dirname, "seed/no-unused-private-class-members.cross.json"), "[\n" + add.map(c => "\t" + JSON.stringify(c)).join(",\n") + "\n]\n");
const other = {};
for (const c of seed) {
	const ext = extOf(c);
	const rules = tree.filter(r => r !== RULE).map(r => (r === "no-dupe-class-members" && /tsx?$/.test(ext) ? "@typescript-eslint/no-dupe-class-members" : r));
	const m = run(c.code, ext, rules);
	if (!m) continue;
	for (const id of new Set(m.map(x => x.ruleId).filter(Boolean))) other[id] = (other[id] || 0) + 1;
}
console.log(JSON.stringify({ fromTheTree: add.length, seedCasesWithALineOfAnotherRule: other }));
