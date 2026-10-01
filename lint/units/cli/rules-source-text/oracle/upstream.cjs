// Research scratch: the cases of ESLint's own test of one rule, every run of the file, with what the file gives each case.
// usage: node upstream.cjs <rule>   prints a JSON array of { kind, code, run, options?, languageOptions?, parser?, filename?, errors? }.
// `run` is the index of the RuleTester.run call; `languageOptions` is the one of the tester merged with the one of the case, without its parser.
"use strict";
const Module = require("module");
const rule = process.argv[2];
const root = "/workspace/ref/eslint";
const file = `${root}/tests/lib/rules/${rule}.js`;
const out = [];
let runs = 0;
function RuleTester(config) {
	const base = (config && config.languageOptions) || {};
	return {
		run(name, r, tests) {
			const run = runs++;
			for (const kind of ["valid", "invalid"])
				for (const raw of tests[kind]) {
					const t = typeof raw === "string" ? { code: raw } : raw;
					const lo = { ...base, ...(t.languageOptions || {}) };
					const parser = lo.parser ? (typeof lo.parser === "string" ? lo.parser : lo.parser.__name || "custom") : undefined;
					delete lo.parser;
					out.push({
						kind,
						code: t.code,
						run,
						options: t.options,
						languageOptions: Object.keys(lo).length ? lo : undefined,
						parser,
						filename: t.filename,
						errors: t.errors,
					});
				}
		},
	};
}
const origLoad = Module._load;
Module._load = function (request) {
	if (request.endsWith("rule-tester/rule-tester") || request.endsWith("rule-tester")) return RuleTester;
	if (request.startsWith("../../../lib/rules/")) return {};
	if (request.startsWith("@typescript-eslint/")) return { __name: request };
	if (request.includes("fixtures/parsers") || request.includes("/parsers")) return { __name: request.replace(/^.*fixtures\/parsers\//, "fixture:") };
	return origLoad.apply(this, arguments);
};
require(file);
process.stdout.write(JSON.stringify(out, null, "\t") + "\n");
