// The fixture against the vectors that oracle/diff.cjs just wrote for it: `expect` is what the probe printed (sorted, an equal
// report once), `differs` and `eslint` are what ESLint at the pin printed where the two answers are not the same.
// usage: node check-fixture.cjs <fixture.json> <vectors.json>
"use strict";
const fs = require("fs");
const fixture = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const vectors = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const pick = m => ({ line: m.line, column: m.column, message: m.message });
const order = (a, b) => a.line - b.line || a.column - b.column || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0);
const once = list => list.sort(order).filter((m, i) => i === 0 || order(list[i - 1], m) !== 0);
if (fixture.length !== vectors.length) throw new Error(`${fixture.length} cases, ${vectors.length} vectors`);
let bad = 0;
const seen = new Set();
fixture.forEach((c, i) => {
	const v = vectors[i];
	const problems = [];
	const key = (c.jsx ? "J" : "") + c.code;
	if (seen.has(key)) problems.push("the case is twice in the fixture");
	seen.add(key);
	if (v.code !== c.code || !!v.jsx !== !!c.jsx) problems.push("another case");
	else if (v.expect === null || v.eslint === null) problems.push("a parser rejects it");
	else {
		if (JSON.stringify(once(v.expect.map(pick))) !== JSON.stringify(c.expect)) problems.push("expect is not what the probe printed");
		if ((v.differs || null) !== (c.differs || null)) problems.push(`differs is ${c.differs}, the oracle says ${v.differs}`);
		if (v.differs && JSON.stringify(v.eslint.map(pick).sort(order)) !== JSON.stringify(c.eslint)) problems.push("eslint is not what ESLint printed");
		if (!v.differs && c.eslint) problems.push("eslint without differs");
	}
	if (problems.length) {
		bad += 1;
		console.log(`${JSON.stringify(c.code)}: ${problems.join("; ")}`);
	}
});
const n = f => fixture.filter(f).length;
console.log(
	`${fixture.length} cases: ${n(c => c.expect.length)} with a report, ${n(c => !c.expect.length)} without, ${n(c => c.differs)} that differ from ESLint (${[...new Set(fixture.filter(c => c.differs).map(c => c.differs))].join(", ")}), ${n(c => c.eslintTest)} with the code of a case of ESLint's own test, ${n(c => c.jsx)} with jsx; ${bad} that are not what the oracle says`,
);
process.exit(bad ? 1 : 0);
