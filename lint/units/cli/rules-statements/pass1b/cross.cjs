// Research probe: which rules of a set report on the cases of the fixtures of other rules (ESLint at the pin).
// usage: node cross.cjs
"use strict";
const fs = require("fs");
const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });

const MINE = ["for-direction", "no-async-promise-executor", "no-case-declarations", "no-delete-var", "no-prototype-builtins", "no-setter-return", "no-unsafe-finally", "no-unused-labels", "no-useless-catch", "no-with", "require-yield", "no-unused-private-class-members"];
const ROUND1 = ["no-debugger", "no-dupe-keys", "no-dupe-class-members", "no-duplicate-case", "no-empty-pattern", "no-compare-neg-zero", "use-isnan", "valid-typeof", "no-unsafe-negation", "no-sparse-arrays", "no-self-assign"];
const D3_OTHERS = ["getter-return", "no-cond-assign", "no-constant-binary-expression", "no-constant-condition", "no-control-regex", "no-dupe-else-if", "no-empty", "no-empty-character-class", "no-empty-static-block", "no-extra-boolean-cast", "no-fallthrough", "no-invalid-regexp", "no-irregular-whitespace", "no-loss-of-precision", "no-misleading-character-class", "no-nonoctal-decimal-escape", "no-octal", "no-regex-spaces", "no-unexpected-multiline", "no-unsafe-optional-chaining", "no-useless-backreference", "no-useless-escape"];
const D4 = ["constructor-super", "no-class-assign", "no-const-assign", "no-dupe-args", "no-ex-assign", "no-func-assign", "no-global-assign", "no-import-assign", "no-new-native-nonconstructor", "no-obj-calls", "no-redeclare", "no-shadow-restricted-names", "no-this-before-super", "no-undef", "no-unreachable", "no-unused-vars"];
const ALL = [...MINE, ...ROUND1, ...D3_OTHERS, ...D4];
const rules = Object.fromEntries(ALL.map(r => [r, "error"]));

function verify(code, jsx) {
	for (const [t, j] of [["script", jsx], ["module", jsx], ["script", true], ["module", true]]) {
		const messages = linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType: t, parserOptions: { ecmaFeatures: { jsx: j } } }, rules }]);
		if (!messages.some(m => m.fatal)) return messages;
	}
	return null;
}

// 1. The fixtures in the tree: which of MINE report on their cases.
const dir = "/workspace/wt/cli/test/cli/lint/rules";
const hits = {};
for (const f of fs.readdirSync(dir).sort()) {
	const owner = f.slice(0, -5);
	for (const c of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) {
		const messages = verify(c.code, !!c.jsx);
		if (!messages) continue;
		for (const m of messages) {
			if (!MINE.includes(m.ruleId)) continue;
			((hits[m.ruleId] ||= {})[owner] ||= new Map()).set((c.jsx ? "jsx:" : "js:") + c.code, { code: c.code, jsx: c.jsx, line: m.line, column: m.column, message: m.message });
		}
	}
}
const crossOut = {};
for (const [rule, owners] of Object.entries(hits)) {
	crossOut[rule] = {};
	for (const [owner, map] of Object.entries(owners)) {
		crossOut[rule][owner] = [...map.values()];
		console.log(`existing fixture ${owner}: ${map.size} cases where ${rule} reports`);
	}
}
fs.writeFileSync("/tmp/rs1b/out-cross-existing.json", JSON.stringify(crossOut, null, "\t"));

// 2. The cases of ESLint's own tests of MINE: which other rules report on them.
const counts = {};
for (const rule of MINE) {
	const cases = JSON.parse(fs.readFileSync(`/tmp/rs1b/out/${rule}.json`, "utf8"));
	for (const c of cases) {
		if (c.parse !== "ok") continue;
		const messages = verify(c.code, !!c.jsx);
		if (!messages) continue;
		const others = new Set(messages.map(m => m.ruleId).filter(r => r && r !== rule));
		for (const o of others) ((counts[rule] ||= {})[o] ||= 0), (counts[rule][o] += 1);
	}
}
for (const [rule, byOther] of Object.entries(counts)) {
	const group = r => (MINE.includes(r) ? "mine" : ROUND1.includes(r) ? "round1" : D3_OTHERS.includes(r) ? "d3" : "d4");
	console.log(`cases of ${rule}: ` + Object.entries(byOther).sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o}[${group(o)}] ${n}`).join(", "));
}
