// Research scratch of "rules-unused": the cases of the fixtures of the other rules on which no-unused-private-class-members
// reports (ESLint's core rule): rules.test.ts asks that each is a case of this rule too.
// usage: node cross-nupcm.cjs [fixtures dir, default the tree's test/cli/lint/rules] [--json]
"use strict";
const fs = require("fs"), path = require("path");
const { ask } = require("./nupcm-oracle.cjs");
const args = process.argv.slice(2);
const json = args.includes("--json");
const dir = args.find(a => !a.startsWith("--")) || "/workspace/wt/cli/test/cli/lint/rules";
const out = [];
const per = {};
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json") && f !== "no-unused-private-class-members.json")) {
	for (const c of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) {
		if (!c.code.includes("#")) continue;
		const ext = c.ext || (c.jsx ? "jsx" : "js");
		const answer = ask(c.code, ext);
		if (!answer.length || answer[0].startsWith("FATAL")) continue;
		per[f] = (per[f] || 0) + 1;
		const item = { code: c.code };
		if (c.jsx) item.jsx = true;
		if (c.ext) item.ext = c.ext;
		item.expect = answer.map(line => { const m = /^(\d+):(\d+) (.*)$/s.exec(line); return { line: Number(m[1]), column: Number(m[2]), message: m[3] }; });
		out.push(item);
	}
}
if (json) process.stdout.write(JSON.stringify(out, null, "\t") + "\n");
else console.log(JSON.stringify({ cases: out.length, per }));
