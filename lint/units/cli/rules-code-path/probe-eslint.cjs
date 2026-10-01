// Research scratch: what ESLint reports for sources given on the command line or in a JSON list, for the four rules.
// usage: node probe-eslint.cjs [--ext ts] [--rules a,b] -e "src" ...   |   node probe-eslint.cjs --list cases.json --out answers.jsonl
"use strict";
const fs = require("fs");
const { verify } = require("../round2-oracle/proto-1b/eslint-side.cjs");
let rules = ["getter-return", "no-fallthrough", "constructor-super", "no-this-before-super"];
let ext = "js";
const sources = [];
let out = null;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--ext") ext = args[++i];
	else if (args[i] === "--rules") rules = args[++i].split(",");
	else if (args[i] === "-e") sources.push({ code: args[++i], ext });
	else if (args[i] === "--out") out = args[++i];
	else if (args[i] === "--list") for (const c of JSON.parse(fs.readFileSync(args[++i], "utf8"))) sources.push(typeof c === "string" ? { code: c, ext } : { code: c.code, ext: c.ext || (c.jsx ? "jsx" : "js") });
}
const lines = [];
for (const s of sources) {
	const r = verify(s.code, s.ext, rules);
	const answer = r.fatal ? { fatal: r.fatal.message } : { eslint: r.messages.map(m => ({ rule: m.ruleId, line: m.line, column: m.column, message: m.message })) };
	lines.push(JSON.stringify({ code: s.code, ext: s.ext, ...answer }));
	if (!out) console.log(`${JSON.stringify(s.code)} [${s.ext}]\n   ${r.fatal ? "FATAL " + r.fatal.message : r.messages.map(m => `${m.ruleId} ${m.line}:${m.column} ${m.message}`).join("\n   ") || "(none)"}`);
}
if (out) fs.writeFileSync(out, lines.join("\n") + "\n");
