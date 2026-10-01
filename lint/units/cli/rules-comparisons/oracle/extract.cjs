// Scratch: pull the cases of an upstream rule test that run with the DEFAULT options, JavaScript only.
const path = require("path");
const Module = require("module");
const rule = process.argv[2];
const file = `/workspace/ref/eslint/tests/lib/rules/${rule}.js`;
let captured;
const fake = { run(name, r, tests) { captured = tests; } };
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
	if (request.endsWith("rule-tester/rule-tester") || request.endsWith("rule-tester")) return function RuleTester() { return fake; };
	if (request.startsWith("../../../lib/rules/")) return {};
	if (request.includes("/parsers") || request.includes("fixtures")) return new Proxy({}, { get: () => () => "PARSER" });
	return origLoad.apply(this, arguments);
};
require(file);
const norm = t => (typeof t === "string" ? { code: t } : t);
const isDefault = t => {
	if (t.languageOptions && t.languageOptions.parser) return false;
	if (t.filename && /\.tsx?$/.test(t.filename)) return false;
	if (!t.options) return true;
	const defaults = { enforceForIndexOf: false, enforceForSwitchCase: true, enforceForOrderingRelations: false, requireStringLiterals: false };
	for (const o of t.options) for (const k of Object.keys(o)) if (defaults[k] !== o[k]) return false;
	return true;
};
const out = { valid: [], invalid: [], skipped: 0 };
for (const kind of ["valid", "invalid"]) for (const raw of captured[kind]) { const t = norm(raw); if (isDefault(t)) out[kind].push({ code: t.code, languageOptions: t.languageOptions }); else out.skipped++; }
process.stdout.write(JSON.stringify(out));
