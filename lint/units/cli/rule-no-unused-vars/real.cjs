// Research scratch of "rule-no-unused-vars": no-unused-vars of `bun --lint` over real files, against ESLint at the pin
// (the core rule for JavaScript, @typescript-eslint/no-unused-vars for TypeScript; no comment configures a run).
// usage: BUN_LINT_EXE=/workspace/wt/cli/build/debug/bun-debug node real.cjs [--show N] [--list files.txt] <file>...
// The acceptance line is `extra`: a report of Bun on a name that ESLint calls used. `missing` is where Bun is silent.
// A file that either parser rejects is counted and left out. At most one bun process at a time, 100 files each.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const BUN = process.env.BUN_LINT_EXE || "/workspace/wt/cli/build/debug/bun-debug";
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const tsPlugin = req("@typescript-eslint/eslint-plugin");
const linter = new Linter({ configType: "flat" });
const RULE = "no-unused-vars";
const TS = new Set(["ts", "tsx", "mts", "cts"]);
const args = process.argv.slice(2);
let show = 40;
const files = [];
while (args.length) {
	const a = args.shift();
	if (a === "--show") show = Number(args.shift());
	else if (a === "--list") files.push(...fs.readFileSync(args.shift(), "utf8").split("\n").filter(Boolean).map(f => path.resolve(f)));
	else files.push(path.resolve(a));
}
function eslint(code, file) {
	const ext = file.split(".").pop();
	const ts = TS.has(ext);
	const rule = ts ? `@typescript-eslint/${RULE}` : RULE;
	const tries = ts ? [[ext === "cts" ? "commonjs" : "module", ext === "tsx"]] : ext === "mjs" ? [["module", true]] : ext === "cjs" ? [["commonjs", true]] : [["module", true], ["script", true], ["commonjs", true]];
	for (const [sourceType, jsx] of tries) {
		const languageOptions = ts ? { parser: tsParser, ecmaVersion: "latest", sourceType } : { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } };
		const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions, plugins: { "@typescript-eslint": tsPlugin }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { [rule]: "error" } }];
		// The name keeps `.d.ts`: typescript-eslint's rule asks the file name whether the file is a declaration file.
		const messages = linter.verify(code, config, { filename: /\.d\.[cm]?ts$/.test(file) ? `x.d.${ext}` : `x.${ext}` });
		if (!messages.some(m => m.fatal)) return messages.filter(m => m.ruleId === rule).map(m => `${m.line}:${m.column} ${m.message.replace(/\r\n?|\n/g, " ")}`);
	}
	return null;
}
const tally = { files: 0, "eslint-rejects": 0, "bun-rejects": 0, same: 0, "files-with-extra": 0, "files-with-missing-only": 0, reports: 0, extra: 0, missing: 0 };
const shown = [];
const LINE = /^(.*)\((\d+),(\d+)\): (\w+) ([\w-]+): (.*)$/;
for (let i = 0; i < files.length; i += 100) {
	const chunk = files.slice(i, i + 100);
	const r = spawnSync(BUN, ["--lint", ...chunk], { encoding: "utf8", env: { ...process.env, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", ASAN_OPTIONS: "detect_leaks=0" }, maxBuffer: 1 << 30 });
	if (r.status !== 0 && r.status !== 2) throw new Error(`bun ended with ${r.status} ${r.signal}\n${(r.stderr || "").slice(-2000)}`);
	const ours = new Map(chunk.map(f => [f, { lines: [], rejected: false }]));
	for (const line of r.stderr.split("\n")) {
		const m = LINE.exec(line);
		if (!m) continue;
		const f = chunk.find(c => c === path.resolve(m[1]) || c.endsWith("/" + m[1]));
		if (!f) continue;
		if (m[4] === "error" && (m[5] === "syntax" || /^TS\d+$/.test(m[5]))) ours.get(f).rejected = true;
		else if (m[5] === RULE) ours.get(f).lines.push(`${m[2]}:${m[3]} ${m[6]}`);
	}
	for (const f of chunk) {
		tally.files += 1;
		let code;
		try { code = fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""); } catch { continue; }
		const theirs = eslint(code, f);
		const mine = ours.get(f);
		if (!theirs) { tally["eslint-rejects"] += 1; continue; }
		if (mine.rejected) { tally["bun-rejects"] += 1; continue; }
		const a = [...new Set(theirs)].sort(), b = [...new Set(mine.lines)].sort();
		tally.reports += a.length;
		const extra = b.filter(x => !a.includes(x)), missing = a.filter(x => !b.includes(x));
		tally.extra += extra.length;
		tally.missing += missing.length;
		if (!extra.length && !missing.length) { tally.same += 1; continue; }
		tally[extra.length ? "files-with-extra" : "files-with-missing-only"] += 1;
		if (shown.length < show) shown.push(`${f}\n   extra (only bun):     ${extra.slice(0, 6).join(" | ") || "-"}\n   missing (only eslint): ${missing.slice(0, 6).join(" | ") || "-"}`);
	}
}
console.log(JSON.stringify(tally));
for (const s of shown) console.log(s);
