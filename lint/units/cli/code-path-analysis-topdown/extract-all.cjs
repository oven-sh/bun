// Research scratch: every `code` of ESLint's own rule tests (tests/lib/rules/*.js at the pin), as a corpus of sources.
// usage: node extract-all.cjs <out.json>    writes [{ rule, code, kind: "js"|"ts", jsx, sourceType }], duplicates removed.
// A case whose parser is a fixture (a tree on disk) is left out; one whose parser is typescript-eslint is kind "ts".
"use strict";
const fs = require("fs");
const path = require("path");
const Module = require("module");
const root = "/workspace/ref/eslint";
const dir = path.join(root, "tests/lib/rules");
const TS = { __ts: true };
const FIXTURE = { __fixture: true };
const origLoad = Module._load;
let runs = [];
Module._load = function (request) {
	if (/rule-tester(\/rule-tester)?$/u.test(request)) {
		return function RuleTester(config) {
			return { run(name, r, tests) { runs.push({ config, tests }); } };
		};
	}
	if (request === "@typescript-eslint/parser") return TS;
	if (/fixtures\/parsers|\/parsers\//u.test(request)) return FIXTURE;
	if (request.startsWith("../../../lib/rules/") || request.startsWith("../../../../lib/rules/")) {
		try {
			return origLoad.apply(this, arguments);
		} catch {
			return {};
		}
	}
	try {
		return origLoad.apply(this, arguments);
	} catch (e) {
		return new Proxy(function () { return FIXTURE; }, { get: (t, k) => (k === "__fixture" ? true : () => FIXTURE) });
	}
};
const out = [];
const seen = new Set();
let files = 0;
let failed = 0;
for (const file of fs.readdirSync(dir).sort()) {
	if (!file.endsWith(".js")) continue;
	runs = [];
	try {
		require(path.join(dir, file));
	} catch (e) {
		failed++;
		process.stderr.write(`cannot load ${file}: ${String(e.message).split("\n")[0]}\n`);
		continue;
	}
	files++;
	const rule = file.replace(/\.js$/u, "");
	for (const { config, tests } of runs) {
		const base = (config && config.languageOptions) || {};
		for (const kind of ["valid", "invalid"]) {
			for (const raw of (tests && tests[kind]) || []) {
				const t = typeof raw === "string" ? { code: raw } : raw;
				if (!t || typeof t.code !== "string") continue;
				const lo = { ...base, ...(t.languageOptions || {}) };
				const parser = lo.parser;
				if (parser && parser !== TS) continue;
				const po = { ...(base.parserOptions || {}), ...((t.languageOptions || {}).parserOptions || {}) };
				const isTs = parser === TS || (t.filename && /\.tsx?$/u.test(t.filename) && parser === TS);
				const jsx = Boolean(po.ecmaFeatures && po.ecmaFeatures.jsx);
				const key = `${isTs ? "ts" : "js"}\0${jsx}\0${t.code}`;
				if (seen.has(key)) continue;
				seen.add(key);
				out.push({ rule, code: t.code, kind: isTs ? "ts" : "js", jsx, sourceType: lo.sourceType || null });
			}
		}
	}
}
fs.writeFileSync(process.argv[2], JSON.stringify(out));
process.stderr.write(`${files} test files, ${failed} not loaded, ${out.length} sources (${out.filter(c => c.kind === "ts").length} for typescript-eslint)\n`);
