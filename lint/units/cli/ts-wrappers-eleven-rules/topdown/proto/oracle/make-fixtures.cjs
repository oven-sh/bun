// Trims vectors/<rule>.json to what a test of the command line can assert and writes the fixture of the rule.
// A case that either parser rejects is left out. `eslint` stays only where the answer differs.
// usage: node make-fixtures.cjs [--to dir] <rule>...     default --to: the fixtures of the tree (LINT_FIXTURES)
"use strict";
const fs = require("fs");
const path = require("path");
const { FIXTURES } = require("./common.cjs");
const args = process.argv.slice(2);
let to = FIXTURES;
if (args[0] === "--to") {
	args.shift();
	to = args.shift();
}
const order = (a, b) => a.line - b.line || a.column - b.column || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0);
for (const rule of args) {
	const out = [];
	for (const v of JSON.parse(fs.readFileSync(path.join(__dirname, "vectors", `${rule}.json`), "utf8"))) {
		if (v.expect === null || v.eslint === null) continue;
		const pick = m => ({ line: m.line, column: m.column, message: m.message });
		const c = { code: v.code };
		if (v.ext) c.ext = v.ext;
		else if (v.jsx) c.jsx = true;
		// The command line sorts by position and says an equal diagnostic once.
		const sorted = v.expect.filter(m => !m.code).map(pick).sort(order);
		c.expect = sorted.filter((m, i) => i === 0 || order(sorted[i - 1], m) !== 0);
		if (v.differs) {
			c.differs = v.differs;
			c.eslint = v.eslint.map(pick).sort(order);
		}
		if (v.eslintTest) c.eslintTest = true;
		out.push(c);
	}
	const text = "[\n" + out.map(c => "\t" + JSON.stringify(c)).join(",\n") + "\n]\n";
	fs.mkdirSync(to, { recursive: true });
	fs.writeFileSync(path.join(to, `${rule}.json`), text);
	const count = f => out.filter(f).length;
	console.log(`${rule}: ${out.length} cases, ${count(c => c.expect.length)} with a report, ${count(c => c.ext)} with an extension, ${count(c => c.differs)} that differ from ESLint, ${count(c => c.eslintTest)} of ESLint's own test, ${text.length} bytes`);
}
