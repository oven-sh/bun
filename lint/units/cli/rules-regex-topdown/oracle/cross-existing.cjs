// Research scratch: the cases of the fixtures in the tree on which ESLint reports one of the five regex rules.
// rules.test.ts of the tree takes a line of another rule only when the fixture of that rule has the case too.
// usage: node cross-existing.cjs [dir of rules/*.json] > ../answers/cross-existing-fixtures.json
"use strict";
const fs = require("fs");
const path = require("path");
const { verify } = require("/workspace/notes/lint/units/cli/ts-entry-codes-harness/topdown/tools/eslint-side.cjs");
const RULES = ["no-control-regex", "no-regex-spaces", "no-useless-backreference", "no-misleading-character-class", "no-useless-escape"];
const dir = process.argv[2] || "/workspace/wt/cli/test/cli/lint/rules";
const out = Object.fromEntries(RULES.map(r => [r, []]));
const seen = new Set();
let total = 0;
for (const f of fs.readdirSync(dir).sort()) {
	if (!f.endsWith(".json")) continue;
	for (const c of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) {
		total++;
		const ext = c.ext || (c.jsx ? "jsx" : "js");
		const r = verify(c.code, ext, RULES, { sourceType: ext === "cjs" || ext === "cts" ? "commonjs" : "module" });
		if (r.fatal) continue;
		for (const rule of RULES) {
			if (!r.messages.some(m => m.ruleId === rule)) continue;
			const key = `${rule}:${ext}:${c.code}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out[rule].push(ext === "js" ? { code: c.code, from: f } : { code: c.code, ext, from: f });
		}
	}
}
process.stderr.write(`${total} cases; ` + RULES.map(r => `${r} ${out[r].length}`).join(", ") + "\n");
process.stdout.write(JSON.stringify(out, null, "\t") + "\n");
