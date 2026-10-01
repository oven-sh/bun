// Research scratch of "rule-no-unused-vars": the cases of ESLint's own test that run with options equal to the defaults,
// the string form "all" and an object that restates defaults included. Prints JSON [{code, ext, kind, sourceType?}].
"use strict";
const Module = require("module");
const path = require("path");
const util = require("util");
const ESLINT = "/workspace/ref/eslint";
const file = path.join(ESLINT, "tests/lib/rules/no-unused-vars.js");
const runs = [];
class FakeRuleTester { constructor(config) { this.config = config || {}; } run(name, ruleModule, tests) { runs.push({ config: this.config, tests }); } }
const origLoad = Module._load;
Module._load = function (request, parent) {
	if (/(^|\/)rule-tester(\/rule-tester)?$/.test(request)) return FakeRuleTester;
	return origLoad.apply(this, arguments);
};
require(file);
Module._load = origLoad;
const DEFAULTS = { vars: "all", args: "after-used", ignoreRestSiblings: false, caughtErrors: "all", ignoreClassWithStaticInitBlock: false, ignoreUsingDeclarations: false, reportUsedIgnorePattern: false };
function isDefault(options) {
	if (!options || options.length === 0) return true;
	if (options.length > 1) return false;
	const o = options[0];
	if (typeof o === "string") return o === "all";
	return util.isDeepStrictEqual({ ...DEFAULTS, ...o }, DEFAULTS);
}
const out = [], skipped = {};
const skip = r => (skipped[r] = (skipped[r] || 0) + 1);
for (const { config, tests } of runs) for (const kind of ["valid", "invalid"]) for (const raw of tests[kind] || []) {
	const t = typeof raw === "string" ? { code: raw } : raw;
	const base = config.languageOptions || {}, own = t.languageOptions || {};
	const lo = { ...base, ...own, parserOptions: { ...(base.parserOptions || {}), ...(own.parserOptions || {}) } };
	if (lo.parser) { skip("parser"); continue; }
	if (!isDefault(t.options)) { skip("options"); continue; }
	if (own.globals && Object.keys(own.globals).length) { skip("globals"); continue; }
	const jsx = !!(lo.parserOptions.ecmaFeatures && lo.parserOptions.ecmaFeatures.jsx);
	const c = { code: t.code, ext: jsx ? "jsx" : "js", kind };
	if (lo.sourceType) c.sourceType = lo.sourceType;
	if (lo.parserOptions.ecmaFeatures && lo.parserOptions.ecmaFeatures.globalReturn) c.globalReturn = true;
	out.push(c);
}
process.stderr.write(JSON.stringify({ cases: out.length, skipped, valid: out.filter(c => c.kind === "valid").length, invalid: out.filter(c => c.kind === "invalid").length }) + "\n");
process.stdout.write(JSON.stringify(out));
