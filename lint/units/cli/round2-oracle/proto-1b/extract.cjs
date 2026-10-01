// PROTOTYPE of research pass 1b. The cases of ESLint's own test of a rule: every RuleTester.run of the file, TypeScript cases kept.
// usage: node extract.cjs <rule> [--all]
//   prints { cases: [{ code, ext, kind, sourceType? }], skipped: { <reason>: n } } as JSON: the cases that run with the default options.
//   --all: prints [{ code, ext }] of every case of the file, whatever its options (to mark `eslintTest`).
// `ext` is the file that the case is for `bun --lint`: ts or tsx where the case names @typescript-eslint/parser
// (or a fixture parser under typescript-parsers/), the extension of `filename` when it has one of ours, else jsx or js.
"use strict";
const Module = require("module");
const path = require("path");
const util = require("util");
const { ESLINT, EXTS } = require("./eslint-side.cjs");
const rule = process.argv[2];
const all = process.argv.includes("--all");
const file = path.join(ESLINT, "tests/lib/rules", `${rule}.js`);
const runs = [];
class FakeRuleTester {
	constructor(config) {
		this.config = config || {};
	}
	run(name, ruleModule, tests) {
		runs.push({ config: this.config, tests });
	}
}
const TS = { __parser: "ts" };
const stub = () => new Proxy(function () {}, { get: (t, k) => (k === "__parser" ? undefined : stub()), apply: () => stub(), construct: () => stub() });
const origLoad = Module._load;
Module._load = function (request, parent) {
	if (/(^|\/)rule-tester(\/rule-tester)?$/.test(request)) return FakeRuleTester;
	if (request === "@typescript-eslint/parser") return TS;
	// The module of the rule under test is not needed to read the cases.
	if (request.startsWith("../../../lib/rules/") && parent && parent.filename === file) return {};
	if (/fixtures[\\/]parsers[\\/]/.test(request) && !/fixture-parser$/.test(request)) return { __parser: "fixture:" + request.replace(/^.*fixtures[\\/]parsers[\\/]/, "") };
	try {
		return origLoad.apply(this, arguments);
	} catch (e) {
		// A module of ESLint's development dependencies, which the checkout of the oracle does not install.
		if (e && e.code === "MODULE_NOT_FOUND") return stub();
		throw e;
	}
};
require(file);
Module._load = origLoad;
const realRule = require(path.join(ESLINT, "lib/rules", `${rule}.js`));
const defaults = (realRule.meta && realRule.meta.defaultOptions) || null;
// Whether the options of a case are the defaults of the rule. Without `meta.defaultOptions`: only a case without options.
function isDefault(options) {
	if (!options || options.length === 0) return true;
	if (!defaults) return false;
	const merge = (d, o) => (d && o && typeof d === "object" && typeof o === "object" && !Array.isArray(d) && !Array.isArray(o) ? Object.fromEntries([...new Set([...Object.keys(d), ...Object.keys(o)])].map(k => [k, k in o ? merge(d[k], o[k]) : d[k]])) : o);
	const merged = defaults.map((d, i) => (i < options.length ? merge(d, options[i]) : d));
	return options.length <= defaults.length && util.isDeepStrictEqual(merged, defaults);
}
const out = { cases: [], skipped: {} };
const every = [];
const skip = reason => (out.skipped[reason] = (out.skipped[reason] || 0) + 1);
for (const { config, tests } of runs) {
	for (const kind of ["valid", "invalid"]) {
		for (const raw of tests[kind] || []) {
			const t = typeof raw === "string" ? { code: raw } : raw;
			if (typeof t.code !== "string") continue;
			const base = config.languageOptions || {};
			const own = t.languageOptions || {};
			const lo = { ...base, ...own, parserOptions: { ...(base.parserOptions || {}), ...(own.parserOptions || {}) } };
			const parser = lo.parser && lo.parser.__parser;
			const jsx = !!(lo.parserOptions.ecmaFeatures && lo.parserOptions.ecmaFeatures.jsx);
			const named = t.filename && path.extname(t.filename).slice(1);
			let ext;
			if (lo.parser && !parser) {
				skip("another parser");
				continue;
			}
			if (parser === "ts" || (parser && parser.startsWith("fixture:typescript-parsers"))) ext = named === "tsx" || jsx ? "tsx" : named === "mts" || named === "cts" ? named : "ts";
			else if (parser) {
				skip("a fixture parser that is not TypeScript");
				continue;
			} else if (named && EXTS.includes(named)) ext = named;
			else ext = jsx ? "jsx" : "js";
			every.push({ code: t.code, ext });
			if (!isDefault(t.options)) {
				skip("options that are not the defaults");
				continue;
			}
			if (lo.globals && Object.keys(lo.globals).length) {
				skip("globals");
				continue;
			}
			if (typeof lo.ecmaVersion === "number" && lo.ecmaVersion < 6) {
				skip("an edition before 2015");
				continue;
			}
			if (t.settings || t.only) skip("settings");
			const c = { code: t.code, ext, kind };
			if (lo.sourceType) c.sourceType = lo.sourceType;
			out.cases.push(c);
		}
	}
}
if (all) {
	const seen = new Set();
	process.stdout.write(JSON.stringify(every.filter(c => !seen.has(c.ext + ":" + c.code) && seen.add(c.ext + ":" + c.code))) + "\n");
} else process.stdout.write(JSON.stringify(out, null, "\t") + "\n");
