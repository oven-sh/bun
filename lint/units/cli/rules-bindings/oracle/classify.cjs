// Research scratch of "rules-bindings": for a list of cases, what ESLint at the pin reports as a module (.js) and as
// commonjs (.cjs) with ecmaVersion latest and the globals of Bun, and whether the debug build of the worktree parses the file.
// usage: node classify.cjs <rule> <cases.json>... [--ts] > vectors.json      (cases: codes, { code }, or { valid, invalid })
// Output: [{ code, module: reports | null, commonjs: reports | null, bunJs: "ok" | message, bunCjs: "ok" | message }], null = ESLint's parser rejects.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const args = process.argv.slice(2);
const ts = args.includes("--ts");
const rule = args[0];
const files = args.slice(1).filter(a => a !== "--ts");
const globals = {};
for (const g of fs.readFileSync("/workspace/notes/lint/units/cli/name-resolution/oracle/bun-globals.txt", "utf8").split("\n").filter(l => !l.startsWith("#")).join(" ").split(/\s+/).filter(Boolean)) globals[g.replace(/:w$/, "")] = g.endsWith(":w") ? "writable" : "readonly";
const codes = [];
const seen = new Set();
for (const f of files) {
	const j = JSON.parse(fs.readFileSync(f, "utf8"));
	const list = Array.isArray(j) ? j : [...j.valid, ...j.invalid];
	for (const c of list) {
		const code = typeof c === "string" ? c : c.code;
		if (!seen.has(code)) { seen.add(code); codes.push(code); }
	}
}
const req = require("module").createRequire("/workspace/ref/tseslint/package.json");
const parser = ts ? req("@typescript-eslint/parser") : undefined;
const plugin = ts ? req("@typescript-eslint/eslint-plugin") : undefined;
const linter = new Linter({ configType: "flat" });
const ruleId = ts && rule === "no-redeclare" ? "@typescript-eslint/no-redeclare" : rule;
function eslint(code, sourceType) {
	const config = {
		files: ["**/*"],
		plugins: plugin ? { "@typescript-eslint": plugin } : {},
		languageOptions: { ecmaVersion: "latest", sourceType, globals, ...(parser ? { parser } : {}), parserOptions: { ecmaFeatures: { jsx: !ts } } },
		linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
		rules: { [ruleId]: "error" },
	};
	const filename = ts ? (sourceType === "commonjs" ? "a.cts" : "a.ts") : sourceType === "commonjs" ? "a.cjs" : "a.js";
	const messages = linter.verify(code, [config], { filename });
	if (messages.some(m => m.fatal)) return null;
	return messages.filter(m => m.ruleId === ruleId).map(m => ({ line: m.line, column: m.column, message: m.message }));
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rb-classify-"));
const exts = ts ? ["ts", "cts"] : ["js", "cjs"];
const bun = {};
for (const ext of exts) {
	const names = codes.map((c, i) => `c${String(i).padStart(4, "0")}.${ext}`);
	names.forEach((n, i) => fs.writeFileSync(path.join(dir, n), codes[i]));
	bun[ext] = codes.map(() => "ok");
	for (let i = 0; i < names.length; i += 400) {
		const r = spawnSync("/workspace/wt/cli/build/debug/bun-debug", ["--lint", ...names.slice(i, i + 400)], { cwd: dir, env: { ...process.env, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", ASAN_OPTIONS: "detect_leaks=0" }, encoding: "utf8", maxBuffer: 1 << 28 });
		for (const line of r.stderr.split("\n")) {
			const m = /^c(\d+)\.\w+\((\d+),(\d+)\): error (syntax|TS\d+): (.*)$/.exec(line);
			if (m && bun[ext][+m[1]] === "ok") bun[ext][+m[1]] = `${m[2]}:${m[3]} ${m[5]}`;
		}
	}
}
fs.rmSync(dir, { recursive: true, force: true });
const out = codes.map((code, i) => ({ code, module: eslint(code, "module"), commonjs: eslint(code, "commonjs"), bunJs: bun[exts[0]][i], bunCjs: bun[exts[1]][i] }));
process.stdout.write("[\n" + out.map(o => "\t" + JSON.stringify(o)).join(",\n") + "\n]\n");
