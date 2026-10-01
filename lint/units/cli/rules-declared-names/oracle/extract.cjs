// Research scratch of "rules-bindings": ESLint's own cases of one of the ten binding rules.
// usage: node extract.cjs <rule>   prints { valid, invalid, skipped } as JSON. A case keeps `code`, `languageOptions` (the
// defaults of the tester merged in), `options` and, for an invalid one, its `errors`. `skipped` counts the cases with a parser of their own.
"use strict";
const Module = require("module");
const rule = process.argv[2];
const root = "/workspace/ref/eslint";
const file = `${root}/tests/lib/rules/${rule}.js`;
const runs = [];
const origLoad = Module._load;
Module._load = function (request) {
	if (request.endsWith("rule-tester/rule-tester") || request.endsWith("rule-tester")) {
		return function RuleTester(config) {
			return { run(name, r, tests) { runs.push({ config, tests }); } };
		};
	}
	if (request.startsWith("../../../lib/rules/")) return {};
	if (request.includes("/parsers") || request.includes("fixtures/parsers") || request.startsWith("@typescript-eslint/")) return new Proxy(function () { return "PARSER"; }, { get: () => () => "PARSER" });
	return origLoad.apply(this, arguments);
};
require(file);
const norm = t => (typeof t === "string" ? { code: t } : t);
const out = { valid: [], invalid: [], skipped: 0, runs: runs.length };
for (const { config, tests } of runs) {
	const base = (config && config.languageOptions) || {};
	for (const kind of ["valid", "invalid"])
		for (const raw of tests[kind]) {
			const t = norm(raw);
			if (t.languageOptions && t.languageOptions.parser) { out.skipped++; continue; }
			const lo = { ...base, ...(t.languageOptions || {}) };
			const c = { code: t.code };
			if (Object.keys(lo).length) c.languageOptions = lo;
			if (t.options) c.options = t.options;
			if (t.filename) c.filename = t.filename;
			if (kind === "invalid" && t.errors) c.errors = Array.isArray(t.errors) ? t.errors.map(e => (typeof e === "string" ? { message: e } : { messageId: e.messageId, message: e.message, line: e.line, column: e.column, data: e.data })) : t.errors;
			out[kind].push(c);
		}
}
process.stdout.write(JSON.stringify(out, null, "\t") + "\n");
