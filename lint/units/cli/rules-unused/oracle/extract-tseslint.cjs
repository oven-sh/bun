// Research scratch of "rules-unused": the cases of a test file of typescript-eslint (checkout /workspace/ref/typescript-eslint, v8.58.2).
// usage: node extract-tseslint.cjs <test file relative to packages/eslint-plugin/tests/rules>   prints { valid, invalid } as JSON.
// A case keeps code, options, filename, languageOptions (the defaults of the tester merged in) and, when invalid, errors
// (messageId, line, column, data). The test is TypeScript: it is transpiled in memory and run with its imports stubbed.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const ts = req("typescript");
const file = path.join("/workspace/ref/typescript-eslint/packages/eslint-plugin/tests/rules", process.argv[2]);
const js = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const runs = [];
class RuleTester {
	constructor(config) { this.config = config || {}; }
	defineRule() {}
	run(name, rule, tests) { runs.push({ config: this.config, tests }); }
}
const noFormat = (strings, ...keys) => String.raw({ raw: strings.raw }, ...keys);
const stub = request => {
	if (request === "@typescript-eslint/rule-tester") return { RuleTester, noFormat };
	if (request.endsWith("/RuleTester")) return { getFixturesRootDir: () => "/fixtures" };
	if (request.includes("/src/")) return new Proxy({ default: {} }, { get: (t, k) => (k in t ? t[k] : () => {}) });
	if (request === "@typescript-eslint/utils") return req("@typescript-eslint/utils");
	return require(request);
};
const module_ = { exports: {} };
vm.runInNewContext(js, { require: stub, module: module_, exports: module_.exports, console, process, describe: (n, f) => f(), it: (n, f) => f(), test: (n, f) => f() }, { filename: file });
const out = { valid: [], invalid: [] };
for (const { config, tests } of runs) {
	const base = (config && config.languageOptions) || {};
	for (const kind of ["valid", "invalid"]) {
		for (const raw of tests[kind]) {
			const t = typeof raw === "string" ? { code: raw } : raw;
			const c = { code: t.code };
			const lo = { ...base, ...(t.languageOptions || {}), parserOptions: { ...(base.parserOptions || {}), ...((t.languageOptions || {}).parserOptions || {}) } };
			c.languageOptions = lo;
			if (t.options) c.options = t.options;
			if (t.filename) c.filename = t.filename;
			if (kind === "invalid") c.errors = (t.errors || []).map(e => ({ messageId: e.messageId, line: e.line, column: e.column, data: e.data }));
			out[kind].push(c);
		}
	}
}
process.stdout.write(JSON.stringify(out, null, "\t") + "\n");
