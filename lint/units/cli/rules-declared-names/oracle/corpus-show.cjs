"use strict";
const fs = require("fs"), path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const ROOT = "/workspace/wt/cli";
const [list, kind, rule, maxFiles, maxShow] = process.argv.slice(2);
const globals = {};
for (const g of fs.readFileSync("/workspace/notes/lint/units/cli/name-resolution/oracle/bun-globals.txt", "utf8").split("\n").filter(l => !l.startsWith("#")).join(" ").split(/\s+/).filter(Boolean)) globals[g.replace(/:w$/, "")] = g.endsWith(":w") ? "writable" : "readonly";
const req = require("module").createRequire("/workspace/ref/tseslint/package.json");
const parser = kind === "ts" ? req("@typescript-eslint/parser") : undefined;
const plugin = kind === "ts" ? req("@typescript-eslint/eslint-plugin") : undefined;
const linter = new Linter({ configType: "flat" });
const files = fs.readFileSync(list, "utf8").split("\n").filter(Boolean).filter(f => (kind === "ts" ? /\.[cm]?tsx?$/.test(f) : /\.[cm]?jsx?$/.test(f))).slice(0, +maxFiles);
let shown = 0;
for (const f of files) {
	let code; try { code = fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { continue; }
	if (code.length > 400000) continue;
	const ext = path.extname(f).slice(1);
	const sourceType = /^c[jt]s$/.test(ext) ? "commonjs" : "module";
	const id = kind === "ts" && rule === "no-redeclare" ? "@typescript-eslint/no-redeclare" : rule;
	let messages;
	try { messages = linter.verify(code, [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], plugins: plugin ? { "@typescript-eslint": plugin } : {}, languageOptions: { ecmaVersion: "latest", sourceType, globals, ...(parser ? { parser } : {}), parserOptions: { ecmaFeatures: { jsx: kind !== "ts" || ext === "tsx" } } }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { [id]: "error" } }], { filename: "a." + ext }); } catch { continue; }
	const lines = code.split("\n");
	for (const m of messages) {
		if (!m.ruleId) continue;
		console.log(`${f}:${m.line}:${m.column} ${m.message}   | ${(lines[m.line - 1] || "").trim().slice(0, 110)}`);
		if (++shown >= +maxShow) process.exit(0);
	}
}
