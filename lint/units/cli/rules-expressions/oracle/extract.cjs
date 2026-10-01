// Research scratch. ESLint's own cases of one of the six rules on expression shape that run with the DEFAULT options and ESLint's parser.
// usage: node extract.cjs <rule>   prints { valid, invalid, skipped, tester } as JSON: `code`, `languageOptions` (tester defaults merged in) are kept.
"use strict";
const Module = require("module");
const rule = process.argv[2];
const root = "/workspace/ref/eslint";
const file = `${root}/tests/lib/rules/${rule}.js`;
const runs = [];
let testerConfig;
const origLoad = Module._load;
Module._load = function (request) {
	if (request.endsWith("rule-tester/rule-tester") || request.endsWith("rule-tester")) {
		return function RuleTester(config) {
			testerConfig = config;
			return { run(name, r, tests) { runs.push({ config, tests }); } };
		};
	}
	if (request.startsWith("../../../lib/rules/")) return {};
	if (request === "PARSER") return "PARSER";
	if (request.includes("/parsers") || request.includes("fixtures") || request.startsWith("@typescript-eslint/")) return new Proxy(function () { return "PARSER"; }, { get: () => () => "PARSER" });
	return origLoad.apply(this, arguments);
};
require(file);
const norm = t => (typeof t === "string" ? { code: t } : t);
// Whether the options of a case are the defaults of the rule.
const isDefaultOptions = {
	"no-cond-assign": o => o.length === 0 || (o.length === 1 && o[0] === "except-parens"),
	"no-constant-binary-expression": o => o.every(x => !x.checkRelationalComparisons),
	"no-constant-condition": o => o.every(x => x.checkLoops === undefined || x.checkLoops === "allExceptWhileTrue"),
	"no-dupe-else-if": o => o.length === 0,
	"no-extra-boolean-cast": o => o.every(x => !x.enforceForLogicalOperands && !x.enforceForInnerExpressions),
	"no-unsafe-optional-chaining": o => o.every(x => !x.disallowArithmeticOperators),
}[rule];
const out = { valid: [], invalid: [], skipped: 0, tester: testerConfig || null, runs: runs.length };
const { config, tests } = runs[0];
const base = (config && config.languageOptions) || {};
for (const kind of ["valid", "invalid"])
	for (const raw of tests[kind]) {
		const t = norm(raw);
		const parserGiven = t.languageOptions && t.languageOptions.parser;
		if (parserGiven || (t.filename && /\.tsx?$/.test(t.filename)) || !isDefaultOptions(t.options || [])) {
			out.skipped++;
			continue;
		}
		const lo = { ...base, ...(t.languageOptions || {}) };
		const c = { code: t.code };
		if (Object.keys(lo).length) c.languageOptions = lo;
		if (kind === "invalid" && t.errors) c.errors = Array.isArray(t.errors) ? t.errors.map(e => (typeof e === "string" ? { message: e } : { messageId: e.messageId, line: e.line, column: e.column, data: e.data })) : t.errors;
		out[kind].push(c);
	}
process.stdout.write(JSON.stringify(out, null, "\t") + "\n");
