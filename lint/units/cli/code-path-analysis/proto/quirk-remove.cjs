// Counts how often `removeFromArray` of code-path-state.js is asked to remove a value that the array does not hold:
// `elements.splice(elements.indexOf(value), 1)` then removes the LAST element (splice(-1, 1)).
// usage: node quirk-remove.cjs <code>... | --dir <dir>
"use strict";
const Module = require("module");
const fs = require("fs");
const path = require("path");
const target = "/workspace/ref/eslint/lib/linter/code-path-analysis/code-path-state.js";
const compile = Module.prototype._compile;
global.__quirk = { missing: 0, missingNonEmpty: 0, calls: 0 };
Module.prototype._compile = function (content, filename) {
	if (filename === target) {
		const needle = "elements.splice(elements.indexOf(value), 1);";
		if (!content.includes(needle)) throw new Error("needle");
		content = content.replace(needle, "__quirk.calls++; if (elements.indexOf(value) < 0) { __quirk.missing++; if (elements.length) __quirk.missingNonEmpty++; } " + needle);
	}
	return compile.call(this, content, filename);
};
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
const sources = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--dir") {
		const todo = [args[++i]];
		while (todo.length) {
			const d = todo.pop();
			let entries = [];
			try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
			for (const e of entries) {
				const p = path.join(d, e.name);
				if (e.isDirectory()) { if (e.name !== ".git") todo.push(p); } else if (/\.(js|cjs|mjs)$/u.test(e.name)) sources.push({ file: p });
			}
		}
	} else sources.push({ code: args[i] });
}
for (const s of sources) {
	let code = s.code;
	if (s.file) { try { code = fs.readFileSync(s.file, "utf8"); } catch { continue; } if (code.length > 2e6) continue; }
	const before = { ...__quirk };
	for (const sourceType of ["module", "commonjs", "script"]) {
		const m = linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType }, rules: { "no-unreachable": 2 } }]);
		if (!m.some(x => x.fatal)) break;
	}
	if (s.code) console.log(JSON.stringify(code), "calls", __quirk.calls - before.calls, "missing", __quirk.missing - before.missing, "missing from a non-empty array", __quirk.missingNonEmpty - before.missingNonEmpty);
}
console.log("total", JSON.stringify(__quirk), "sources", sources.length);
