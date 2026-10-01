// Research scratch: lists the cases of ESLint's own test of one of the six rules that run with the DEFAULT options and ESLint's parser.
// usage: node extract.cjs <rule> [--all]   prints { base, valid, invalid, skipped } as JSON.
//   base: the languageOptions of the RuleTester of the file. Each case keeps `code` and its own `languageOptions`.
//   skipped: [{ code, why }] for the cases with an option that is not the default, or with another parser.
"use strict";
const Module = require("module");
const rule = process.argv[2];
const root = "/workspace/ref/eslint";
const file = `${root}/tests/lib/rules/${rule}.js`;
let captured = null;
let base = null;
const origLoad = Module._load;
Module._load = function (request) {
	if (request.endsWith("rule-tester/rule-tester") || request.endsWith("rule-tester")) {
		return function RuleTester(config) {
			base = base || (config && config.languageOptions) || null;
			return { run(name, r, tests) { captured = captured || tests; } };
		};
	}
	if (request.startsWith("../../../lib/rules/") || request === "PARSER") return {};
	if (request.includes("/parsers") || request.includes("fixtures") || request.startsWith("@typescript-eslint/")) return new Proxy(function () { return "PARSER"; }, { get: () => () => "PARSER" });
	return origLoad.apply(this, arguments);
};
require(file);
// What is the default of each rule: an option list that says only this is a case of the defaults.
const isDefaultOptions = {
	"no-cond-assign": o => o.length === 0 || (o.length === 1 && o[0] === "except-parens"),
	"no-constant-binary-expression": o => o.every(x => !x.checkRelationalComparisons),
	"no-constant-condition": o => o.every(x => x.checkLoops === undefined || x.checkLoops === "allExceptWhileTrue"),
	"no-dupe-else-if": o => o.length === 0,
	"no-extra-boolean-cast": o => o.every(x => !x.enforceForInnerExpressions && !x.enforceForLogicalOperands),
	"no-unsafe-optional-chaining": o => o.every(x => !x.disallowArithmeticOperators),
}[rule];
if (!isDefaultOptions) throw new Error(`not one of the six rules: ${rule}`);
const out = { base, valid: [], invalid: [], skipped: [] };
for (const kind of ["valid", "invalid"]) {
	for (const raw of captured[kind]) {
		const t = typeof raw === "string" ? { code: raw } : raw;
		let why = null;
		if (t.languageOptions && t.languageOptions.parser) why = "parser";
		else if (t.filename && /\.tsx?$/.test(t.filename)) why = "filename";
		else if (t.options && !isDefaultOptions(t.options)) why = "options " + JSON.stringify(t.options);
		if (why) {
			out.skipped.push({ kind, code: t.code, why });
			continue;
		}
		const c = { code: t.code };
		if (t.languageOptions) c.languageOptions = t.languageOptions;
		if (kind === "invalid") c.errors = Array.isArray(t.errors) ? t.errors.length : t.errors;
		out[kind].push(c);
	}
}
process.stdout.write(JSON.stringify(out, null, "\t") + "\n");
