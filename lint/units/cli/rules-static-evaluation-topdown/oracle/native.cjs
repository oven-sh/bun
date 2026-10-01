// Research scratch. The six rules of the native probe (`/tmp/rse-td/probe six`: Bun's tree, the wrapper records, Bun's lexer; probe/build.py)
// against ESLint at the pin, case by case: typescript-eslint's parser for a case with `ext`.
// usage: node native.cjs [--show] <list.json>...     a list: an array of codes or of { code, jsx?, ext? }, or { valid, invalid } of extract.cjs
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const tsParser = require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const six = ["no-cond-assign", "no-constant-binary-expression", "no-constant-condition", "no-dupe-else-if", "no-extra-boolean-cast", "no-unsafe-optional-chaining"];
const rules = Object.fromEntries(six.map(r => [r, "error"]));
const show = process.argv.includes("--show");
// No comment configures a run of `bun --lint`: a corpus of real files is compared without ESLint's comments too.
const linterOptions = { noInlineConfig: true, reportUnusedDisableDirectives: "off" };
function eslint(c) {
	if (c.ext) {
		const tsx = c.ext === "tsx";
		return linter.verify(c.code, [{ files: ["**/*.ts", "**/*.tsx"], linterOptions, languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: tsx } }, sourceType: "module" }, rules }], { filename: tsx ? "a.tsx" : "a.ts" });
	}
	let messages;
	for (const [t, j] of [["script", !!c.jsx], ["module", !!c.jsx], ["script", true], ["module", true]]) {
		messages = linter.verify(c.code, [{ linterOptions, languageOptions: { ecmaVersion: "latest", sourceType: t, parserOptions: { ecmaFeatures: { jsx: j } } }, rules }]);
		if (!messages.some(m => m.fatal)) break;
	}
	return messages;
}
let total = 0, same = 0, reports = 0;
const kinds = {};
for (const f of process.argv.slice(2).filter(a => a.endsWith(".json"))) {
	const parsed = JSON.parse(fs.readFileSync(f, "utf8"));
	const cases = (Array.isArray(parsed) ? parsed : [...parsed.valid, ...parsed.invalid]).map(c => (typeof c === "string" ? { code: c } : c)).filter(c => !(c.languageOptions && c.languageOptions.globals));
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rx-six-"));
	const names = cases.map((c, i) => `c${String(i).padStart(4, "0")}.${c.ext ? (c.ext === "tsx" ? "tsx" : "ts") : "js"}`);
	cases.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
	const ours = cases.map(() => null);
	for (let from = 0; from < names.length; from += 300) {
		const run = spawnSync("/tmp/rse-td/probe", ["six", ...names.slice(from, from + 300)], { cwd: dir, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, encoding: "utf8", maxBuffer: 1 << 28 });
		for (const line of run.stdout.split("\n")) {
			let m = /^c(\d+)\.\w+: (OK|PARSE_ERROR)/.exec(line);
			if (m) { ours[Number(m[1])] = m[2] === "OK" ? [] : null; continue; }
			m = /^c(\d+)\.\w+\((\d+),(\d+)\): ([\w-]+): (.*)$/.exec(line);
			if (m) ours[Number(m[1])].push(`${m[4]} ${m[2]}:${m[3]} ${m[5]}`);
		}
		if (run.status !== 0) console.log(`probe exit ${run.status} ${run.signal || ""} ${run.stderr.slice(0, 400)}`);
	}
	fs.rmSync(dir, { recursive: true, force: true });
	let fileTotal = 0, fileSame = 0;
	cases.forEach((c, i) => {
		const messages = eslint(c);
		if (messages.some(m => m.fatal) || ours[i] === null) { console.log(`left out (${ours[i] === null ? "Bun" : "ESLint"} rejects): ${c.file || JSON.stringify(c.code)}`); return; }
		fileTotal++;
		reports += messages.filter(m => six.includes(m.ruleId)).length;
		const theirs = [...new Set(messages.filter(m => six.includes(m.ruleId)).map(m => `${m.ruleId} ${m.line}:${m.column} ${m.message}`))].sort();
		const mine = [...new Set(ours[i])].sort();
		if (JSON.stringify(theirs) === JSON.stringify(mine)) { fileSame++; if (show) console.log(`same   ${JSON.stringify(c.code)}\n    ${theirs.join(" | ") || "(none)"}`); return; }
		const kind = mine.every(x => theirs.includes(x)) ? "missing" : theirs.every(x => mine.includes(x)) ? "extra" : "other";
		kinds[kind] = (kinds[kind] || 0) + 1;
		const label = c.file || JSON.stringify(c.code);
		const only = (a, b) => a.filter(x => !b.includes(x));
		console.log(c.file ? `DIFFER ${kind} ${label}\n    only eslint: ${only(theirs, mine).join(" | ") || "(none)"}\n    only native: ${only(mine, theirs).join(" | ") || "(none)"}` : `DIFFER ${kind} ${label}\n    eslint: ${theirs.join(" | ") || "(none)"}\n    native: ${mine.join(" | ") || "(none)"}`);
	});
	console.log(`${path.basename(f)}: cases ${fileTotal}, same ${fileSame}, differ ${fileTotal - fileSame}`);
	total += fileTotal; same += fileSame;
}
console.log(`all: cases ${total}, same ${same}, differ ${total - same} ${JSON.stringify(kinds)}; reports of ESLint ${reports}`);
