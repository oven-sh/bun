// PROTOTYPE of research pass 1b. For every case of the fixtures: which OTHER rules of eslint:recommended ESLint reports on it.
// usage: node cross-eslint.cjs [dir of rules/*.json]    Needs no build of bun.
"use strict";
const fs = require("fs");
const path = require("path");
const { verify } = require("./eslint-side.cjs");
const ALL = require("./recommended.cjs");
const dir = process.argv[2] || "/workspace/wt/cli/test/cli/lint/rules";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
const have = new Set(files.map(f => f.slice(0, -5)));
const fixtures = Object.fromEntries(files.map(f => [f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))]));
const key = c => `${c.ext || (c.jsx ? "jsx" : "js")}:${c.code}`;
const keys = Object.fromEntries(Object.entries(fixtures).map(([r, cs]) => [r, new Set(cs.map(key))]));
const byOther = {};
for (const [rule, cases] of Object.entries(fixtures)) {
	const tally = {};
	let casesWithOther = 0, casesWithFuture = 0;
	for (const c of cases) {
		const ext = c.ext || (c.jsx ? "jsx" : "js");
		const r = verify(c.code, ext, ALL);
		if (r.fatal) continue;
		const others = new Set(r.messages.map(m => m.ruleId).filter(id => id !== rule));
		if (others.size) casesWithOther += 1;
		let future = false;
		for (const o of others) {
			tally[o] = (tally[o] || 0) + 1;
			if (!have.has(o)) future = true;
			byOther[o] = byOther[o] || { cases: 0, inOwnFixture: 0 };
			byOther[o].cases += 1;
			if (have.has(o) && keys[o].has(key(c))) byOther[o].inOwnFixture += 1;
		}
		if (future) casesWithFuture += 1;
	}
	const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}${have.has(k) ? "*" : ""} ${n}`).join(", ");
	console.log(`${rule}: ${cases.length} cases, ${casesWithOther} with a report of another rule, ${casesWithFuture} with one of a rule that has no fixture yet\n    ${top}`);
}
console.log("\nby other rule (cases over all fixtures; for a rule with a fixture: how many of them its own fixture holds):");
for (const [o, v] of Object.entries(byOther).sort((a, b) => b[1].cases - a[1].cases)) console.log(`  ${o}${have.has(o) ? "*" : ""}: ${v.cases}${have.has(o) ? ` (own fixture has ${v.inOwnFixture})` : ""}`);
