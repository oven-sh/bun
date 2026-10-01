// Lists the cases of ESLint's own test of a rule that run with the DEFAULT options and the default parser.
// usage: node extract.cjs <rule> [eslint checkout] [--all]   prints { valid, invalid, skipped } as JSON; only `code`, `languageOptions` are kept.
// --all: prints the code of every case of the file instead, whatever its options, as a JSON array.
"use strict";
const Module = require("module");
const rule = process.argv[2];
const all = process.argv.includes("--all");
const root = process.argv[3] && process.argv[3] !== "--all" ? process.argv[3] : "/workspace/ref/eslint";
const file = `${root}/tests/lib/rules/${rule}.js`;
let captured;
// The first run is the JavaScript one: a later run of the file uses another parser.
const every = [];
const fake = { run(name, r, tests) { captured = captured || tests; for (const k of ["valid", "invalid"]) for (const c of tests[k]) every.push(typeof c === "string" ? c : c.code); } };
const origLoad = Module._load;
Module._load = function (request) {
	if (request.endsWith("rule-tester/rule-tester") || request.endsWith("rule-tester")) return function RuleTester() { return fake; };
	if (request.startsWith("../../../lib/rules/")) return {};
	if (request.includes("/parsers") || request.includes("fixtures") || request.startsWith("@typescript-eslint/")) return new Proxy({}, { get: () => () => "PARSER" });
	return origLoad.apply(this, arguments);
};
require(file);
if (all) {
	process.stdout.write(JSON.stringify([...new Set(every)]) + "\n");
	process.exit(0);
}
const norm = t => (typeof t === "string" ? { code: t } : t);
const defaults = {
	enforceForIndexOf: false,
	enforceForSwitchCase: true,
	enforceForOrderingRelations: false,
	requireStringLiterals: false,
	props: true,
	allowObjectPatternsAsParameters: false,
};
const isDefault = t => {
	if (t.languageOptions && t.languageOptions.parser) return false;
	if (t.filename && /\.tsx?$/.test(t.filename)) return false;
	if (!t.options) return true;
	for (const o of t.options) for (const k of Object.keys(o)) if (defaults[k] !== o[k]) return false;
	return true;
};
const out = { valid: [], invalid: [], skipped: 0 };
for (const kind of ["valid", "invalid"])
	for (const raw of captured[kind]) {
		const t = norm(raw);
		if (isDefault(t)) out[kind].push(t.languageOptions ? { code: t.code, languageOptions: t.languageOptions } : { code: t.code });
		else out.skipped++;
	}
process.stdout.write(JSON.stringify(out, null, "\t") + "\n");
