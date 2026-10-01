// Research scratch of "rules-unused" (pass 1b): the cases of typescript-eslint's own tests of no-unused-vars that run
// with the default options (cases/tseslint-no-unused-vars.json, cases/tseslint-no-unused-vars-eslint.json, made by
// extract-tseslint-cases.cjs), with the answer of @typescript-eslint/no-unused-vars at the pin as `expect`, in the
// form of test/cli/lint/rules/no-unused-vars.json. They add to ../../rule-no-unused-vars/topdown/seed/no-unused-vars.json.
// A file of bun is a module (`.cts`: CommonJS); the tests adapted from ESLint run as scripts upstream: --check lists
// the cases where the answer here is not what the test file expects.
// usage: node make-seed-nuv-tseslint.cjs [--check] > seed/no-unused-vars.tseslint.json
"use strict";
const fs = require("fs");
const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const tsPlugin = req("@typescript-eslint/eslint-plugin");
const linter = new Linter({ configType: "flat" });
const RULE = "@typescript-eslint/no-unused-vars";
const check = process.argv.includes("--check");
function once(code, ext) {
	const config = [{ files: ["**/*.{ts,tsx,mts,cts}"], languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: ext === "cts" ? "commonjs" : "module" }, plugins: { "@typescript-eslint": tsPlugin }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { [RULE]: "error" } }];
	const messages = linter.verify(code, config, { filename: `c.${ext}` });
	if (messages.some(m => m.fatal)) return null;
	return messages.filter(m => m.ruleId === RULE).map(m => ({ line: m.line, column: m.column, message: m.message }));
}
const text = e => e.messageId === "usedOnlyAsType" ? `'${e.data.varName}' is ${e.data.action} but only used as a type${e.data.additional || ""}.` : e.messageId === "unusedVar" ? `'${e.data.varName}' is ${e.data.action} but never used${e.data.additional || ""}.` : `<${e.messageId}>`;
const seen = new Set(), out = [];
const tally = { cases: 0, rejected: 0, withReports: 0, reports: 0, byExt: {}, asUpstream: 0, notAsUpstream: 0, inlineComments: 0 };
for (const f of ["cases/tseslint-no-unused-vars.json", "cases/tseslint-no-unused-vars-eslint.json"]) for (const c of JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8"))) {
	const key = `${c.ext}:${c.code}`;
	if (seen.has(key)) continue;
	seen.add(key);
	const expect = once(c.code, c.ext);
	if (!expect) { tally.rejected += 1; if (check) console.error(`REJECTED [${c.ext}] ${JSON.stringify(c.code).slice(0, 200)}`); continue; }
	// What the test file expects, as far as it says: the texts, and the places it gives.
	const upstream = c.errors.map(e => ({ line: e.line, column: e.column, message: e.data ? text(e) : undefined }));
	const same = upstream.length === expect.length && upstream.every((u, i) => (u.line === undefined || u.line === expect[i].line) && (u.column === undefined || u.column === expect[i].column) && (u.message === undefined || u.message === expect[i].message));
	if (same) tally.asUpstream += 1; else { tally.notAsUpstream += 1; if (check) console.error(`NOT AS UPSTREAM [${c.ext}${c.sourceType ? " " + c.sourceType : ""}] ${JSON.stringify(c.code).slice(0, 300)}\n  upstream: ${JSON.stringify(upstream)}\n  here:     ${JSON.stringify(expect)}`); }
	if (/\/\*\s*(eslint|global|exported)/.test(c.code)) tally.inlineComments += 1;
	const o = { code: c.code, ext: c.ext, expect, tseslintTest: true };
	out.push(o);
	tally.cases += 1; tally.reports += expect.length; if (expect.length) tally.withReports += 1; tally.byExt[c.ext] = (tally.byExt[c.ext] || 0) + 1;
}
const ascii = line => line.replace(/[\u007f-\uffff]/g, ch => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
if (!check) process.stdout.write("[\n" + out.map(c => "\t" + ascii(JSON.stringify(c))).join(",\n") + "\n]\n");
process.stderr.write(JSON.stringify(tally) + "\n");
