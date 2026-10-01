// Lists the cases of ESLint's own test of a rule that run with the DEFAULT options: every run of the file, the runs with the
// parser of typescript-eslint included (their cases get `ext`: ts, or tsx when the case asks for JSX).
// usage: node extract.cjs <rule> [--all]   prints { valid, invalid, skipped } as JSON; a case is { code, ext?, sourceType?, jsx? }.
// --all: prints every case of the file instead, whatever its options, as a JSON array of { code, ext? }.
"use strict";
const Module = require("module");
const path = require("path");
const { ESLINT_DIR } = require("./common.cjs");
const rule = process.argv[2];
const all = process.argv.includes("--all");
const file = path.join(ESLINT_DIR, "tests/lib/rules", `${rule}.js`);

// What stands for a parser that a test file loads: only which parser it is matters here.
const TS_PARSER = { __parser: "@typescript-eslint/parser" };
const OTHER_PARSER = new Proxy({ __parser: "other" }, { get: (t, k) => (k in t ? t[k] : () => OTHER_PARSER) });
const runs = [];
function RuleTester(config) {
	return { run: (name, r, tests) => runs.push({ config: config || {}, tests }) };
}
const origLoad = Module._load;
Module._load = function (request) {
	if (request.endsWith("rule-tester/rule-tester") || request.endsWith("rule-tester")) return RuleTester;
	if (request.startsWith("../../../lib/rules/") && !request.includes("/utils/")) return {};
	if (request === "@typescript-eslint/parser") return TS_PARSER;
	if (request.includes("/parsers") || request.includes("fixtures") || request.startsWith("@typescript-eslint/")) return OTHER_PARSER;
	return origLoad.apply(this, arguments);
};
require(file);
Module._load = origLoad;

// The options that are the defaults of a rule: a case that states only these runs as the defaults do.
const defaults = {
	enforceForIndexOf: false,
	enforceForSwitchCase: true,
	enforceForOrderingRelations: false,
	requireStringLiterals: false,
	props: true,
	allowObjectPatternsAsParameters: false,
};
const norm = t => (typeof t === "string" ? { code: t } : t);
// The case as this pipeline runs it, or null: another parser than espree and typescript-eslint, globals, an edition before 2015.
function shape(t, runConfig) {
	const lo = { ...(runConfig.languageOptions || {}), ...(t.languageOptions || {}) };
	const po = { ...((runConfig.languageOptions || {}).parserOptions || {}), ...((t.languageOptions || {}).parserOptions || {}) };
	const jsx = !!(po.ecmaFeatures && po.ecmaFeatures.jsx);
	const named = t.filename && /\.([cm]?[jt]sx?)$/.exec(t.filename);
	const c = { code: t.code };
	if (lo.parser && lo.parser !== TS_PARSER) return null;
	if (lo.globals || (typeof lo.ecmaVersion === "number" && lo.ecmaVersion < 6)) return null;
	if (lo.parser === TS_PARSER) c.ext = named && /^[cm]?tsx?$/.test(named[1]) ? named[1] : jsx ? "tsx" : "ts";
	else if (named && named[1] !== "js" && named[1] !== "jsx") c.ext = named[1];
	else {
		if (lo.sourceType) c.sourceType = lo.sourceType;
		if (jsx || (named && named[1] === "jsx")) c.jsx = true;
	}
	return c;
}
const isDefault = t => !t.options || t.options.every(o => typeof o === "object" && o !== null && Object.keys(o).every(k => defaults[k] === o[k]));

if (all) {
	const seen = new Set();
	const out = [];
	for (const { config, tests } of runs)
		for (const kind of ["valid", "invalid"])
			for (const raw of tests[kind] || []) {
				const c = shape(norm(raw), config) || { code: norm(raw).code };
				const key = `${c.ext || ""}:${c.code}`;
				if (!seen.has(key)) {
					seen.add(key);
					out.push(c.ext ? { code: c.code, ext: c.ext } : { code: c.code });
				}
			}
	process.stdout.write(JSON.stringify(out) + "\n");
	process.exit(0);
}
const out = { valid: [], invalid: [], skipped: 0 };
for (const { config, tests } of runs)
	for (const kind of ["valid", "invalid"])
		for (const raw of tests[kind] || []) {
			const t = norm(raw);
			const c = isDefault(t) ? shape(t, config) : null;
			if (c) out[kind].push(c);
			else out.skipped++;
		}
process.stdout.write(JSON.stringify(out, null, "\t") + "\n");
