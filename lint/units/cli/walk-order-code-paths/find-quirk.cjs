// Research scratch: the shortest sources of a corpus on which removeFromArray of upstream removes the last element of a
// non-empty array because the value is not in it (splice(-1, 1)).
// usage: node find-quirk.cjs corpus.json [n]
"use strict";
const Module = require("module");
const fs = require("fs");
const target = "/workspace/ref/eslint/lib/linter/code-path-analysis/code-path-state.js";
const compile = Module.prototype._compile;
global.__hit = 0;
Module.prototype._compile = function (content, filename) {
	if (filename === target) {
		const needle = "elements.splice(elements.indexOf(value), 1);";
		if (!content.includes(needle)) throw new Error("needle");
		content = content.replace(needle, "if (elements.indexOf(value) < 0 && elements.length) __hit++; " + needle);
	}
	return compile.call(this, content, filename);
};
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
const cases = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const found = [];
for (const c of cases) {
	if (c.kind !== "js") continue;
	const before = __hit;
	const m = linter.verify(c.code, [{ languageOptions: { ecmaVersion: "latest", sourceType: "module" }, rules: { "getter-return": 2 } }]);
	if (m.some(x => x.fatal)) continue;
	if (__hit > before) found.push(c.code);
}
found.sort((a, b) => a.length - b.length);
console.log(found.length);
for (const code of found.slice(0, Number(process.argv[3] || 5))) console.log(JSON.stringify(code));
