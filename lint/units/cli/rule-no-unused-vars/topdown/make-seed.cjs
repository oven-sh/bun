// Research scratch of "rule-no-unused-vars": the seed of test/cli/lint/rules/no-unused-vars.json, with ESLint's answer as `expect`.
// The cases, each once: ESLint's own test with options equal to the defaults (extract-default-cases.cjs), then cases/*.json beside this file.
// JavaScript: the core rule. TypeScript: @typescript-eslint/no-unused-vars. No comment configures a run. A case that the parser rejects is left out.
// usage: node make-seed.cjs > seed/no-unused-vars.json      (stderr: the tally)
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const tsPlugin = req("@typescript-eslint/eslint-plugin");
const linter = new Linter({ configType: "flat" });
const isTs = ext => /tsx?$/.test(ext);
function once(code, ext, sourceType, jsx) {
	const ts = isTs(ext);
	const languageOptions = ts ? { parser: tsParser, ecmaVersion: "latest", sourceType: ext === "cts" ? "commonjs" : "module" } : { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } };
	const rule = ts ? "@typescript-eslint/no-unused-vars" : "no-unused-vars";
	const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions, plugins: { "@typescript-eslint": tsPlugin }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { [rule]: "error" } }];
	const messages = linter.verify(code, config, { filename: `c.${ts ? ext : jsx ? "jsx" : ext}` });
	if (messages.some(m => m.fatal)) return null;
	return messages.filter(m => m.ruleId === rule).map(m => ({ line: m.line, column: m.column, message: m.message }));
}
function verify(c) {
	if (isTs(c.ext)) return { ext: c.ext, expect: once(c.code, c.ext) };
	const tries = c.ext === "mjs" ? [["module", false]] : c.ext === "cjs" ? [["commonjs", false]] : c.ext === "jsx" ? [["script", true], ["module", true]] : [["script", false], ["module", false], ["script", true], ["module", true]];
	for (const [type, jsx] of tries) { const expect = once(c.code, c.ext, type, jsx); if (expect) return { ext: jsx && c.ext === "js" ? "jsx" : c.ext, expect }; }
	return { ext: c.ext, expect: null };
}
const cases = [];
for (const c of JSON.parse(execFileSync(process.execPath, [path.join(__dirname, "extract-default-cases.cjs")], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }))) cases.push({ code: c.code, ext: c.ext, eslintTest: true });
for (const f of fs.readdirSync(path.join(__dirname, "cases")).sort()) if (f.endsWith(".json")) for (const c of JSON.parse(fs.readFileSync(path.join(__dirname, "cases", f), "utf8"))) cases.push(typeof c === "string" ? { code: c, ext: f.startsWith("ts-") ? "ts" : "js" } : { code: c.code, ext: c.ext || (f.startsWith("ts-") ? "ts" : "js") });
const seen = new Set(), out = [];
const tally = { cases: 0, rejected: 0, withReports: 0, reports: 0, byExt: {} };
for (const c of cases) {
	const r = verify(c);
	const key = `${r.ext}:${c.code}`;
	if (seen.has(key)) continue;
	seen.add(key);
	if (!r.expect) { tally.rejected += 1; continue; }
	const o = { code: c.code };
	if (r.ext === "jsx") o.jsx = true; else if (r.ext !== "js") o.ext = r.ext;
	o.expect = r.expect;
	if (c.eslintTest) o.eslintTest = true;
	out.push(o);
	tally.cases += 1; tally.reports += r.expect.length; if (r.expect.length) tally.withReports += 1; tally.byExt[r.ext] = (tally.byExt[r.ext] || 0) + 1;
}
const ascii = line => line.replace(/[\u007f-\uffff]/g, ch => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
process.stdout.write("[\n" + out.map(c => "\t" + ascii(JSON.stringify(c))).join(",\n") + "\n]\n");
process.stderr.write(JSON.stringify(tally) + "\n");
