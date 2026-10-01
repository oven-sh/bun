// ESLint at the pin over a list of cases: one JSON line per case with the reports of the named rules.
// usage: node oracle.cjs <rule[,rule]> <cases.json | upstream-<rule>.json> [--ts]
//   cases: [{ code, ext?, sourceType? }] or { cases: [...] } (the output of ../round2-oracle/proto-1b/extract.cjs) or [string].
"use strict";
const fs = require("fs");
const { verify } = require("../round2-oracle/proto-1b/eslint-side.cjs");
const rules = process.argv[2].split(",");
const raw = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const list = (Array.isArray(raw) ? raw : raw.cases).map(c => (typeof c === "string" ? { code: c } : c));
for (const c of list) {
	const ext = c.ext || (c.jsx ? "jsx" : "js");
	const r = verify(c.code, ext, rules, c.sourceType);
	const out = { code: c.code, ext: r.ext, sourceType: r.sourceType };
	if (c.kind) out.kind = c.kind;
	if (r.fatal) out.fatal = r.fatal.message;
	else out.reports = r.messages.map(m => `${m.ruleId} ${m.line}:${m.column} ${m.message}`);
	console.log(JSON.stringify(out));
}
