// SCRATCH of the research unit "ts-wrappers-eleven-rules": the eleven rules over real files, the probe against ESLint at the
// pin (typescript-eslint's parser for TypeScript, and its `no-dupe-class-members` there). A file that either parser rejects
// is counted and left out. usage: node real.cjs [--show N] <file>...
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const BUN = process.env.BUN_LINT_EXE || "/tmp/w1b-topdown/out/tsentry";
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const tsPlugin = req("@typescript-eslint/eslint-plugin");
const linter = new Linter({ configType: "flat" });
const RULES = ["no-compare-neg-zero", "no-debugger", "no-dupe-class-members", "no-dupe-keys", "no-duplicate-case", "no-empty-pattern", "no-self-assign", "no-sparse-arrays", "no-unsafe-negation", "use-isnan", "valid-typeof"];
const TS = new Set(["ts", "tsx", "mts", "cts"]);
const args = process.argv.slice(2);
let show = 40;
const files = [];
while (args.length) {
	const a = args.shift();
	if (a === "--show") show = Number(args.shift());
	else files.push(path.resolve(a));
}
function eslint(code, ext) {
	const ts = TS.has(ext);
	const named = r => (ts && r === "no-dupe-class-members" ? `@typescript-eslint/${r}` : r);
	const tries = ts ? [["module", ext === "tsx"]] : [["module", true], ["script", true], ["commonjs", true]];
	for (const [sourceType, jsx] of tries) {
		const languageOptions = ts ? { parser: tsParser, sourceType } : { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } };
		const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions, plugins: ts ? { "@typescript-eslint": tsPlugin } : {}, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: Object.fromEntries(RULES.map(r => [named(r), "error"])) }];
		const messages = linter.verify(code, config, { filename: `x.${ext}` });
		if (!messages.some(m => m.fatal)) return messages.filter(m => m.ruleId).map(m => `${m.line}:${m.column} ${(m.ruleId || "").replace("@typescript-eslint/", "")}: ${m.message.replace(/\r\n?|\n/g, " ")}`);
	}
	return null;
}
const tally = { files: 0, "eslint-rejects": 0, "bun-rejects": 0, same: 0, differ: 0, reports: 0 };
const shown = [];
const LINE = /^(.*)\((\d+),(\d+)\): (\w+) ([\w-]+): (.*)$/;
for (let i = 0; i < files.length; i += 100) {
	const chunk = files.slice(i, i + 100);
	const r = spawnSync(BUN, ["--lint", ...chunk], { encoding: "utf8", env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, maxBuffer: 1 << 30 });
	if (r.status !== 0 && r.status !== 2) throw new Error(`probe ended with ${r.status} ${r.signal}\n${(r.stderr || "").slice(-2000)}`);
	const ours = new Map(chunk.map(f => [f, { lines: [], rejected: false }]));
	for (const line of r.stderr.split("\n")) {
		const m = LINE.exec(line);
		if (!m) continue;
		const f = chunk.find(c => c.endsWith(m[1]) || m[1].endsWith(path.basename(c)));
		if (!f) continue;
		if (m[4] === "error" && (m[5] === "syntax" || /^TS\d+$/.test(m[5]))) ours.get(f).rejected = true;
		else if (RULES.includes(m[5]) || m[5] === "internal-error") ours.get(f).lines.push(`${m[2]}:${m[3]} ${m[5]}: ${m[6]}`);
	}
	for (const f of chunk) {
		tally.files++;
		const code = fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "");
		const ext = f.split(".").pop();
		const theirs = eslint(code, ext);
		const mine = ours.get(f);
		if (!theirs) { tally["eslint-rejects"]++; continue; }
		if (mine.rejected) { tally["bun-rejects"]++; continue; }
		// ESLint's column counts UTF-16 units and so does the plain format.
		const a = [...new Set(theirs)].sort();
		const b = [...new Set(mine.lines)].sort();
		tally.reports += a.length;
		if (JSON.stringify(a) === JSON.stringify(b)) { tally.same++; continue; }
		tally.differ++;
		if (shown.length < show) shown.push(`${f}\n   only eslint: ${a.filter(x => !b.includes(x)).slice(0, 6).join(" | ") || "-"}\n   only bun:    ${b.filter(x => !a.includes(x)).slice(0, 6).join(" | ") || "-"}`);
	}
}
console.log(JSON.stringify(tally));
for (const s of shown) console.log(s);
