// The cross-rule run, outside CI: every rule that has a fixture, in ESLint and in `bun --lint`, over the union of the cases of
// all vectors. A difference in the lines of a rule is explained when the vectors of that rule have the case with `differs`.
// usage: node cross.cjs [--show]     reads vectors/*.json beside this file
"use strict";
const fs = require("fs");
const path = require("path");
const { verifyCase, bunLint, isSyntaxError, flat, keyOf, extOf, rulesWithFixtures } = require("./common.cjs");
const show = process.argv.includes("--show");
const dir = path.join(__dirname, "vectors");
const rules = fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
const missingFixture = rules.filter(r => !rulesWithFixtures().includes(r));
if (missingFixture.length) console.log(`vectors without a fixture in the tree: ${missingFixture.join(", ")}`);
// Per rule: the key of a case -> whether its vector says that the answer differs.
const known = new Map();
const cases = [];
const seen = new Set();
for (const rule of rules) {
	const own = new Map();
	for (const v of JSON.parse(fs.readFileSync(path.join(dir, `${rule}.json`), "utf8"))) {
		const c = { code: v.code };
		if (v.ext) c.ext = v.ext;
		else if (v.jsx) c.jsx = true;
		if (!v.ext && v.sourceType) c.sourceType = v.sourceType;
		const key = keyOf(c) + (c.sourceType || "");
		own.set(key, v.differs || (v.eslint === null || v.expect === null ? "rejected" : null));
		if (!seen.has(key)) {
			seen.add(key);
			c.key = key;
			cases.push(c);
		}
	}
	known.set(rule, own);
}
(async () => {
	const theirs = cases.map(c => verifyCase(c, rules));
	const ours = await bunLint(cases);
	const tally = { cases: cases.length, same: 0, "eslint-rejects": 0, "bun-rejects": 0, "both-reject": 0, explained: 0, uncovered: 0, contradicts: 0 };
	const perRule = {};
	const lines = [];
	cases.forEach((c, i) => {
		const e = theirs[i];
		const rejected = ours[i].some(isSyntaxError);
		if (e.fatal || rejected) {
			tally[e.fatal && rejected ? "both-reject" : rejected ? "bun-rejects" : "eslint-rejects"] += 1;
			return;
		}
		let worst = "same";
		for (const rule of rules) {
			const key = m => `${m.line}:${m.column} ${flat(m.message)}`;
			const a = [...new Set(e.reports.filter(m => m.rule === rule).map(key))].sort();
			const b = [...new Set(ours[i].filter(l => l.code === rule).map(key))].sort();
			if (JSON.stringify(a) === JSON.stringify(b)) continue;
			const own = known.get(rule);
			// explained: the vectors of the rule have the case and say that it differs. uncovered: they do not have the case.
			const kind = !own.has(c.key) ? "uncovered" : own.get(c.key) ? "explained" : "contradicts";
			perRule[rule] = perRule[rule] || { explained: 0, uncovered: 0, contradicts: 0 };
			perRule[rule][kind] += 1;
			if (kind !== "explained" || show) lines.push(`${kind} ${rule}: ${JSON.stringify(c.code)} [${extOf(c)}] [${c.type}]\n    eslint: ${a.join(" | ") || "(none)"}\n    bun:    ${b.join(" | ") || "(none)"}`);
			if (worst === "same" || kind === "contradicts" || (kind === "uncovered" && worst === "explained")) worst = kind;
		}
		// A line of Bun that is of no rule with vectors: an internal error, or a rule that has no case file.
		for (const l of ours[i]) if (!rules.includes(l.code) && !(l.category === "warning" && l.code === "syntax")) lines.push(`other-code ${l.code}: ${JSON.stringify(c.code)} [${extOf(c)}] ${l.line}:${l.column} ${l.message}`);
		tally[worst] += 1;
	});
	for (const l of lines) console.log(l);
	console.log(JSON.stringify(tally));
	console.log(JSON.stringify(perRule));
	process.exit(tally.contradicts || tally.uncovered ? 1 : 0);
})().catch(err => {
	console.error(String(err && err.stack ? err.stack : err));
	process.exit(1);
});
