// Research scratch of "rules-unused" (pass 1b): the cases of a test file of typescript-eslint at v8.58.2
// (/workspace/ref/typescript-eslint, fetched for this: the npm package has no tests).
// usage: node extract-tseslint-cases.cjs <test.ts> [--all]  > cases.json
//   Prints [{kind, code, ext, sourceType?, options?, parserOptions?, errors:[{line?, column?, messageId, data?}], skip?}].
//   Without --all only the cases that run with the default options of the rule and need no tsconfig are printed.
"use strict";
const fs = require("fs");
const path = require("path");
const util = require("util");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const ts = req("typescript");

const file = process.argv[2];
const all = process.argv.includes("--all");
const source = fs.readFileSync(file, "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

const runs = [];
class FakeRuleTester {
	constructor(config) { this.config = config || {}; }
	defineRule() {}
	run(name, rule, tests) { runs.push({ name, config: this.config, tests }); }
}
// The cooked strings stand in as the raw ones, as in packages/rule-tester/src/noFormat.ts.
const noFormat = (raw, ...keys) => String.raw({ raw }, ...keys);
const fakeRequire = request => {
	if (request === "@typescript-eslint/rule-tester") return { RuleTester: FakeRuleTester, noFormat };
	if (/src\/rules\//.test(request)) return { default: {} };
	if (/src\/util$/.test(request)) return { collectVariables() {} };
	if (/RuleTester$/.test(request)) return { getFixturesRootDir: () => "/fixtures", createRuleTesterWithTypes: () => new FakeRuleTester({ typed: true }) };
	if (request.startsWith("@typescript-eslint/")) return require("module").createRequire("/workspace/ref/tseslint/node_modules/@typescript-eslint/eslint-plugin/")(request);
	return require(request);
};
new Function("require", "module", "exports", "__filename", "__dirname", js)(fakeRequire, { exports: {} }, {}, file, path.dirname(file));

// The defaults of @typescript-eslint/no-unused-vars and of the core rule.
const DEFAULTS = { vars: "all", args: "after-used", ignoreRestSiblings: false, caughtErrors: "all", ignoreClassWithStaticInitBlock: false, ignoreUsingDeclarations: false, reportUsedIgnorePattern: false, enableAutofixRemoval: { imports: false } };
function isDefault(options) {
	if (!options || options.length === 0) return true;
	if (options.length > 1) return false;
	const o = options[0];
	if (typeof o === "string") return o === "all";
	return util.isDeepStrictEqual({ ...DEFAULTS, ...o }, DEFAULTS);
}
const out = [];
const skipped = {};
for (const { config, tests } of runs) for (const kind of ["valid", "invalid"]) for (const raw of tests[kind] || []) {
	const t = typeof raw === "string" ? { code: raw } : raw;
	const base = config.languageOptions || {}, own = t.languageOptions || {};
	const po = { ...(base.parserOptions || {}), ...(own.parserOptions || {}) };
	const jsx = !!(po.ecmaFeatures && po.ecmaFeatures.jsx);
	let ext = jsx ? "tsx" : "ts";
	if (t.filename) { const m = /\.(d\.ts|d\.mts|d\.cts|tsx|mts|cts|ts)$/.exec(t.filename); if (m) ext = m[1]; }
	const c = { kind, code: t.code, ext };
	if (po.sourceType && po.sourceType !== "module") c.sourceType = po.sourceType;
	if (t.options && t.options.length) c.options = t.options;
	const poOut = {};
	for (const k of ["project", "projectService", "jsxPragma", "jsxFragmentName", "emitDecoratorMetadata", "experimentalDecorators", "lib"]) if (po[k] !== undefined && po[k] !== false) poOut[k] = po[k];
	if (po.ecmaFeatures && po.ecmaFeatures.globalReturn) poOut.globalReturn = true;
	if (Object.keys(poOut).length) c.parserOptions = poOut;
	if (t.filename) c.filename = t.filename;
	c.errors = (t.errors || []).map(e => ({ line: e.line, column: e.column, messageId: e.messageId, data: e.data }));
	let skip = null;
	if (!isDefault(t.options)) skip = "options";
	else if (poOut.project || poOut.projectService) skip = "tsconfig";
	else if (poOut.jsxPragma !== undefined || poOut.jsxFragmentName !== undefined) skip = "jsxPragma";
	else if (poOut.emitDecoratorMetadata) skip = "emitDecoratorMetadata";
	else if (poOut.globalReturn) skip = "globalReturn";
	else if (own.globals && Object.keys(own.globals).length) skip = "globals";
	if (skip) { skipped[skip] = (skipped[skip] || 0) + 1; c.skip = skip; if (!all) continue; }
	out.push(c);
}
const total = runs.reduce((n, r) => n + (r.tests.valid || []).length + (r.tests.invalid || []).length, 0);
process.stderr.write(JSON.stringify({ file: path.basename(file), total, printed: out.length, valid: out.filter(c => c.kind === "valid").length, invalid: out.filter(c => c.kind === "invalid").length, skipped }) + "\n");
process.stdout.write(JSON.stringify(out, null, "\t"));
