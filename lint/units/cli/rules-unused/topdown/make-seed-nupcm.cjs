// Research scratch of "rules-unused" (pass 1b): the seed of test/cli/lint/rules/no-unused-private-class-members.json,
// with ESLint's answer as `expect` (the core rule; on a TypeScript file the core rule on typescript-eslint's tree).
// The cases, each once: ESLint's own 61 (../cases/upstream-no-unused-private-class-members.json), the 99 of the test of
// typescript-eslint's rule of the same name (cases/tseslint-...json) as `.ts`, cases/own.json, cases/edge-js.json, cases/edge-ts.json.
// `expect` becomes what bun prints; a case where that is not ESLint's answer gets `differs` and `eslint`. A case that a parser rejects is left out.
// usage: node make-seed-nupcm.cjs > seed/no-unused-private-class-members.json      (stderr: the tally)
"use strict";
const fs = require("fs");
const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const RULE = "no-unused-private-class-members";
function once(code, ext, sourceType, jsx) {
	const ts = /tsx?$/.test(ext);
	const languageOptions = ts ? { parser: tsParser, ecmaVersion: "latest", sourceType: ext === "cts" ? "commonjs" : "module" } : { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } };
	const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { [RULE]: "error" } }];
	const messages = linter.verify(code, config, { filename: `c.${ts ? ext : jsx ? "jsx" : ext}` });
	if (messages.some(m => m.fatal)) return null;
	return messages.filter(m => m.ruleId === RULE).map(m => ({ line: m.line, column: m.column, message: m.message }));
}
function verify(c) {
	if (/tsx?$/.test(c.ext)) return { ext: c.ext, expect: once(c.code, c.ext) };
	const tries = c.ext === "mjs" ? [["module", false]] : c.ext === "cjs" ? [["commonjs", false]] : c.ext === "jsx" ? [["script", true], ["module", true]] : [["script", false], ["module", false], ["script", true], ["module", true]];
	for (const [type, jsx] of tries) { const expect = once(c.code, c.ext, type, jsx); if (expect) return { ext: jsx && c.ext === "js" ? "jsx" : c.ext, expect }; }
	return { ext: c.ext, expect: null };
}
const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8"));
const cases = [];
const upstream = read("../cases/upstream-no-unused-private-class-members.json");
for (const k of ["valid", "invalid"]) for (const c of upstream[k]) cases.push({ code: typeof c === "string" ? c : c.code, ext: "js", eslintTest: true });
for (const c of read("cases/tseslint-no-unused-private-class-members.json")) cases.push({ code: c.code, ext: "ts" });
for (const f of ["cases/own.json", "cases/edge-js.json", "cases/edge-ts.json"]) for (const c of read(f)) cases.push({ code: c.code, ext: c.ext || "js" });
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
