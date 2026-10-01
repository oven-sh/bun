// parser-cases.json against the vectors that oracle/diff.cjs wrote for it: each input has the answer that is written with it.
// `kind` is the word of the oracle (`both-reject`, `eslint-rejects`, `bun-rejects`, `extra`, `same`), `bun` the reports of the probe,
// `length` the length in bytes of its one report.
// usage: node check-parser-cases.cjs <parser-cases.json> <vectors.json>
"use strict";
const fs = require("fs");
const cases = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const vectors = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
if (cases.length !== vectors.length) throw new Error(`${cases.length} cases, ${vectors.length} vectors`);
let bad = 0;
const tally = {};
cases.forEach((c, i) => {
	const v = vectors[i];
	const kind = v.eslint === null && v.expect === null ? "both-reject" : v.eslint === null ? "eslint-rejects" : v.expect === null ? "bun-rejects" : v.differs || "same";
	const bun = v.expect === null ? null : v.expect.map(m => `${m.line}:${m.column} ${m.message}`).sort();
	const problems = [];
	if (v.code !== c.code) problems.push("another case");
	if (kind !== c.kind) problems.push(`the oracle says ${kind}`);
	if (c.bun && JSON.stringify(bun) !== JSON.stringify([...c.bun].sort())) problems.push(`the probe reports ${JSON.stringify(bun)}`);
	if (c.length !== undefined && (v.expect.length !== 1 || v.expect[0].length !== c.length)) problems.push(`the length is ${v.expect.map(m => m.length)}`);
	tally[c.kind] = (tally[c.kind] || 0) + 1;
	if (problems.length) {
		bad += 1;
		console.log(`${JSON.stringify(c.code)}: ${problems.join("; ")}`);
	}
});
console.log(`${cases.length} inputs about the parsers, comments and spans (${Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(", ")}): ${bad} that are not as written`);
process.exit(bad ? 1 : 0);
