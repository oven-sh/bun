// Research scratch: how ESLint's own code path analysis (at the pin) behaves at the places a port to Rust has to decide on.
// It patches the text of fork-context.js and code-path-state.js while they load, then runs ESLint over sources.
// usage: node quirks.cjs [--fixtures] [--cases corpus.json] [--files list.txt] [--ts]
"use strict";
const Module = require("module");
const fs = require("fs");
const path = require("path");
const R = "/workspace/ref/eslint/lib/linter/code-path-analysis";
const Q = (global.__q = {
	removeCalls: 0, removeMissing: 0, removeMissingNonEmpty: 0,
	makeUnreachableNoArgs: 0,
	replaceHeadOnEmpty: 0, headOnEmpty: 0,
	createOutOfRange: 0, createUndefinedPrev: 0, createOnEmptyList: 0,
	mergeCalls: 0, mergeOdd: 0, mergeBelowCount: 0,
	addBelowCount: 0, addAllCountDiffers: 0,
	maxCount: 0, maxListLength: 0,
	continueNoDest: 0, breakNoContext: 0, continueNoContext: 0,
	frozenWrites: 0,
	logicalRightOnOtherKind: 0,
});
const compile = Module.prototype._compile;
function sub(content, needle, replacement, file) {
	if (!content.includes(needle)) throw new Error(`needle not found in ${file}: ${needle}`);
	return content.replace(needle, replacement);
}
Module.prototype._compile = function (content, filename) {
	if (filename === path.join(R, "code-path-state.js")) {
		content = sub(content, "elements.splice(elements.indexOf(value), 1);",
			"__q.removeCalls++; if (elements.indexOf(value) < 0) { __q.removeMissing++; if (elements.length) __q.removeMissingNonEmpty++; } elements.splice(elements.indexOf(value), 1);", filename);
		content = sub(content, "this.forkContext.makeUnreachable();", "__q.makeUnreachableNoArgs++; this.forkContext.makeUnreachable();", filename);
		content = sub(content, "context.continueForkContext.add(forkContext.head);\n\t\t\t}\n\t\t}\n\t\tforkContext.replaceHead(forkContext.makeUnreachable(-1, -1));",
			"if (!context.continueForkContext) __q.continueNoDest++; context.continueForkContext.add(forkContext.head);\n\t\t\t}\n\t\t} else { __q.continueNoContext++; }\n\t\tforkContext.replaceHead(forkContext.makeUnreachable(-1, -1));", filename);
		content = sub(content, "if (context) {\n\t\t\tcontext.brokenForkContext.add(forkContext.head);\n\t\t}",
			"if (context) {\n\t\t\tcontext.brokenForkContext.add(forkContext.head);\n\t\t} else { __q.breakNoContext++; }", filename);
	}
	if (filename === path.join(R, "fork-context.js")) {
		content = sub(content, "const normalizedEnd = endIndex >= 0 ? endIndex : list.length + endIndex;",
			"const normalizedEnd = endIndex >= 0 ? endIndex : list.length + endIndex;\n\tif (startIndex !== undefined) { if (list.length === 0) __q.createOnEmptyList++; else if (normalizedBegin < 0 || normalizedEnd >= list.length) __q.createOutOfRange++; }\n\tif (context.count > __q.maxCount) __q.maxCount = context.count; if (list.length > __q.maxListLength) __q.maxListLength = list.length;", filename);
		content = sub(content, "allPrevSegments.push(list[j][i]);", "if (list[j][i] === undefined) __q.createUndefinedPrev++; allPrevSegments.push(list[j][i]);", filename);
		content = sub(content, "let currentSegments = segments;", "let currentSegments = segments; __q.mergeCalls++; if (segments.length > context.count && segments.length % 2) __q.mergeOdd++;", filename);
		content = sub(content, "\treturn currentSegments;\n}", "\tif (currentSegments.length < context.count) __q.mergeBelowCount++;\n\treturn Object.freeze(currentSegments);\n}", filename);
		content = sub(content, "this.segmentsList.splice(\n\t\t\t-1,", "if (this.segmentsList.length === 0) __q.replaceHeadOnEmpty++;\n\t\tthis.segmentsList.splice(\n\t\t\t-1,", filename);
		content = sub(content, "return list.length === 0 ? [] : list.at(-1);", "if (list.length === 0) __q.headOnEmpty++; return list.length === 0 ? [] : list.at(-1);", filename);
	}
	return compile.call(this, content, filename);
};
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
const args = process.argv.slice(2);
const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const sources = [];
if (args.includes("--fixtures")) {
	const dir = "/workspace/ref/eslint/tests/fixtures/code-path-analysis";
	for (const f of fs.readdirSync(dir)) sources.push({ code: fs.readFileSync(path.join(dir, f), "utf8"), ts: false, name: f });
}
if (opt("--cases")) for (const c of JSON.parse(fs.readFileSync(opt("--cases"), "utf8"))) sources.push({ code: c.code, ts: c.kind === "ts", jsx: c.jsx, name: c.rule });
if (opt("--files")) for (const f of fs.readFileSync(opt("--files"), "utf8").split("\n").filter(Boolean)) { try { sources.push({ code: fs.readFileSync(f, "utf8"), ts: /\.tsx?$/u.test(f), jsx: !/\.ts$/u.test(f), name: f }); } catch {} }
let tsParser = null;
const rule = { create() { return { onCodePathStart() {}, onCodePathEnd() {}, onCodePathSegmentStart() {}, onCodePathSegmentEnd() {}, onUnreachableCodePathSegmentStart() {}, onUnreachableCodePathSegmentEnd() {}, onCodePathSegmentLoop() {} }; } };
let ran = 0, fatal = 0, threw = 0;
const thrown = [];
for (const s of sources) {
	let ok = false;
	const tries = s.ts ? ["module"] : ["module", "commonjs", "script"];
	for (const sourceType of tries) {
		const languageOptions = s.ts
			? { parser: (tsParser = tsParser || require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser")), parserOptions: { ecmaFeatures: { jsx: !!s.jsx } }, sourceType }
			: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: true } } };
		try {
			const m = linter.verify(s.code, [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], plugins: { t: { rules: { r: rule } } }, rules: { "t/r": 2 }, languageOptions }], { filename: s.ts ? (s.jsx ? "c.tsx" : "c.ts") : "c.js" });
			if (!m.some(x => x.fatal)) { ok = true; break; }
		} catch (e) {
			threw++;
			if (thrown.length < 5) thrown.push(`${s.name}: ${String(e && e.message).slice(0, 200)}`);
			ok = true;
			break;
		}
	}
	if (ok) ran++; else fatal++;
}
console.log(JSON.stringify({ sources: sources.length, ran, rejected: fatal, threw, thrown }));
console.log(JSON.stringify(Q));
