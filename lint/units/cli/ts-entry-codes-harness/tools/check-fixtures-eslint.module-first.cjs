// PROTOTYPE of research pass 1b. Says whether ESLint's answer for every case of the fixtures in the tree is the one the fixture records
// (`eslint` where the case has `differs`, else `expect`). Needs no build of bun.
// usage: node check-fixtures-eslint.cjs [dir of rules/*.json]
"use strict";
const fs = require("fs");
const path = require("path");
const { verify } = require("./eslint-side.module-first.cjs");
const dir = process.argv[2] || "/workspace/wt/cli/test/cli/lint/rules";
let total = 0, bad = 0;
for (const f of fs.readdirSync(dir).sort()) {
	if (!f.endsWith(".json")) continue;
	const rule = f.slice(0, -5);
	const cases = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
	let wrong = 0;
	for (const c of cases) {
		total += 1;
		const ext = c.ext || (c.jsx ? "jsx" : "js");
		const r = verify(c.code, ext, [rule]);
		const pick = m => `${m.line}:${m.column} ${m.message}`;
		const order = (a, b) => a.line - b.line || a.column - b.column || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0);
		const want = (c.differs ? c.eslint : c.expect).slice().sort(order).map(pick);
		const got = r.fatal ? ["FATAL " + r.fatal.message] : [...new Set(r.messages.slice().sort(order).map(pick))];
		const wantSet = [...new Set(want)];
		if (JSON.stringify(wantSet) !== JSON.stringify(got)) {
			wrong += 1;
			if (wrong <= 5) console.log(`  ${rule}: ${JSON.stringify(c.code)} [${ext}]\n     fixture: ${wantSet.join(" | ") || "(none)"}\n     eslint:  ${got.join(" | ") || "(none)"}`);
		}
	}
	bad += wrong;
	console.log(`${rule}: ${cases.length} cases, ${wrong} where ESLint's answer is not the recorded one`);
}
console.log(`total ${total}, different ${bad}`);
