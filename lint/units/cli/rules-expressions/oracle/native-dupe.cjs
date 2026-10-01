// Research scratch. no-dupe-else-if of the native probe (`/tmp/rx/probe dupe`: Bun's tree, the wrapper records, Bun's lexer)
// against ESLint at the pin, case by case. usage: node native-dupe.cjs <list.json>...
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const tsParser = require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const rules = { "no-dupe-else-if": "error" };
function eslint(c) {
	if (c.ext) {
		const tsx = c.ext === "tsx";
		return linter.verify(c.code, [{ files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: tsx } }, sourceType: "module" }, rules }], { filename: tsx ? "a.tsx" : "a.ts" });
	}
	let messages;
	for (const [t, j] of [["script", !!c.jsx], ["module", !!c.jsx], ["script", true], ["module", true]]) {
		messages = linter.verify(c.code, [{ languageOptions: { ecmaVersion: "latest", sourceType: t, parserOptions: { ecmaFeatures: { jsx: j } } }, rules }]);
		if (!messages.some(m => m.fatal)) break;
	}
	return messages;
}
let total = 0, same = 0;
for (const f of process.argv.slice(2)) {
	const parsed = JSON.parse(fs.readFileSync(f, "utf8"));
	const cases = (Array.isArray(parsed) ? parsed : [...parsed.valid, ...parsed.invalid]).map(c => (typeof c === "string" ? { code: c } : c));
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rx-dupe-"));
	const names = cases.map((c, i) => `c${String(i).padStart(4, "0")}.${c.ext ? (c.ext === "tsx" ? "tsx" : "ts") : "js"}`);
	cases.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
	const run = spawnSync("/tmp/rx/probe", ["dupe", ...names], { cwd: dir, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, encoding: "utf8", maxBuffer: 1 << 28 });
	fs.rmSync(dir, { recursive: true, force: true });
	const ours = cases.map(() => null);
	for (const line of run.stdout.split("\n")) {
		let m = /^c(\d+)\.\w+: (OK|PARSE_ERROR)$/.exec(line);
		if (m) { ours[Number(m[1])] = m[2] === "OK" ? [] : null; continue; }
		m = /^c(\d+)\.\w+\((\d+),(\d+)\): no-dupe-else-if$/.exec(line);
		if (m) ours[Number(m[1])].push(`${m[2]}:${m[3]}`);
	}
	cases.forEach((c, i) => {
		const messages = eslint(c);
		if (messages.some(m => m.fatal) || ours[i] === null) { console.log(`left out (${ours[i] === null ? "Bun" : "ESLint"} rejects): ${JSON.stringify(c.code)}`); return; }
		total++;
		const theirs = [...new Set(messages.map(m => `${m.line}:${m.column}`))].sort();
		const mine = [...ours[i]].sort();
		if (JSON.stringify(theirs) === JSON.stringify(mine)) same++;
		else console.log(`DIFFER ${JSON.stringify(c.code)}\n    eslint: ${theirs.join(" ") || "(none)"}\n    native: ${mine.join(" ") || "(none)"}`);
	});
	if (run.status !== 0) console.log(`probe exit ${run.status} ${run.signal || ""} ${run.stderr.slice(0, 300)}`);
}
console.log(`cases ${total}: same ${same}, differ ${total - same}`);
