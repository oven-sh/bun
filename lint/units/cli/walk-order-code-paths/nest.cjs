// Research scratch: how the count of a fork context grows with `finally` blocks nested in `finally` blocks (ESLint at the pin).
"use strict";
const Module = require("module");
const path = require("path");
const R = "/workspace/ref/eslint/lib/linter/code-path-analysis";
global.__max = 0; global.__created = 0;
const compile = Module.prototype._compile;
Module.prototype._compile = function (content, filename) {
	if (filename === path.join(R, "fork-context.js")) {
		content = content.replace("this.count = count;", "this.count = count; if (count > __max) __max = count;");
	}
	if (filename === path.join(R, "code-path-segment.js")) {
		content = content.replace("this.id = id;", "this.id = id; __created++;");
	}
	return compile.call(this, content, filename);
};
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
for (const depth of process.argv.slice(2).map(Number)) {
	let code = "x;";
	for (let i = 0; i < depth; i++) code = `try { a${i}(); } finally { ${code} }`;
	code = `function f() { ${code} }`;
	__max = 0; __created = 0;
	const t0 = Date.now();
	const m = linter.verify(code, [{ languageOptions: { ecmaVersion: "latest" }, rules: { "getter-return": 2 } }]);
	console.log(JSON.stringify({ depth, bytes: code.length, maxCount: __max, segments: __created, ms: Date.now() - t0, fatal: m.filter(x => x.fatal).length }));
}
