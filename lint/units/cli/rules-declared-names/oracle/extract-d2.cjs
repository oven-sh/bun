// DRAFT (see eslint-side.cjs). The cases of ESLint's own test of a rule: every RuleTester.run of the file, TypeScript cases kept.
// usage: node extract.cjs <rule> [--all]
//   prints { cases: [{ code, ext, kind, sourceType?, inlineConfig? }], skipped: { <reason>: n } } as JSON: the cases that run
//   with the default options of the rule, which are `meta.defaultOptions` of the rule at the pin.
//   --all: prints [{ code, ext }] of every case of the file, whatever its options (to mark `eslintTest`).
// `ext` is what the case says of its file: ts or tsx where it names @typescript-eslint/parser (or a fixture parser under
// typescript-parsers/), the extension of `filename` when it is one of ours, else jsx where JSX is on, else js.
// `sourceType` is what the case or its RuleTester says: diff.cjs finds the extension that carries the case (eslint-side.cjs, carry).
// `inlineConfig`: the code has a comment that configures ESLint. A lint run reads none, and the oracle runs with noInlineConfig.
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
const namedExt = filename => {
	if (!filename) return null;
	const base = path.basename(filename);
	return EXTS.slice().sort((a, b) => b.length - a.length).find(ext => base.endsWith("." + ext)) || null;
};
const INLINE = /(\/\*|\/\/)\s*(eslint\b|eslint-(disable|enable|env)\b|globals?\b|exported\b)/;
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
			const named = namedExt(t.filename);
			let ext;
			if (lo.parser && !parser) {
				skip("another parser");
				continue;
			}
			if (parser === "ts" || (parser && parser.startsWith("fixture:typescript-parsers"))) ext = named && /ts/.test(named) ? named : jsx ? "tsx" : "ts";
			else if (parser) {
				skip("a fixture parser that is not TypeScript");
				continue;
			} else ext = named || (jsx ? "jsx" : "js");
			every.push({ code: t.code, ext });
			if (!isDefault(t.options)) {
				skip("options that are not the defaults");
				continue;
			}
			// As round 1: what the case itself configures. What the RuleTester of the file sets for all its cases is not looked at.
			if (own.globals && Object.keys(own.globals).length) {
				skip("globals");
				continue;
			}
			if (typeof own.ecmaVersion === "number" && own.ecmaVersion < 6) {
				skip("an edition before 2015");
				continue;
			}
			if (t.settings) {
				skip("settings");
				continue;
			}
			const c = { code: t.code, ext, kind, own: true };
			if (lo.sourceType) c.sourceType = lo.sourceType;
			if (INLINE.test(t.code)) c.inlineConfig = true;
			out.cases.push(c);
		}
	}
}
if (all) {
	const seen = new Set();
	process.stdout.write(JSON.stringify(every.filter(c => !seen.has(c.ext + ":" + c.code) && seen.add(c.ext + ":" + c.code))) + "\n");
} else process.stdout.write(JSON.stringify(out, null, "\t") + "\n");
