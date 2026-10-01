// Trims vectors/<rule>.json to what a test of the command line can assert: fixtures/<rule>.json.
// A case that either parser rejects is left out. `eslint` stays only where the answer differs.
// usage: node make-fixtures.cjs
"use strict";
const fs = require("fs");
const path = require("path");
const dir = __dirname;
fs.mkdirSync(path.join(dir, "fixtures"), { recursive: true });
let total = 0;
let bytes = 0;
let merged = 0;
for (const f of fs.readdirSync(path.join(dir, "vectors")).sort()) {
	if (!f.endsWith(".json") || f.includes("eslint-rejects")) continue;
	const out = [];
	for (const v of JSON.parse(fs.readFileSync(path.join(dir, "vectors", f), "utf8"))) {
		if (v.expect === null || v.eslint === null) continue;
		const pick = m => ({ line: m.line, column: m.column, message: m.message });
		const c = { code: v.code };
		if (v.jsx) c.jsx = true;
		// The command line sorts by position and says an equal diagnostic once.
		const order = (a, b) => a.line - b.line || a.column - b.column || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0);
		const once = list => list.sort(order).filter((m, i) => i === 0 || order(list[i - 1], m) !== 0);
		c.expect = once(v.expect.map(pick));
		if (c.expect.length !== v.expect.length) merged += 1;
		if (v.differs) {
			c.differs = v.differs;
			c.eslint = v.eslint.map(pick).sort(order);
		}
		if (v.eslintTest) c.eslintTest = true;
		out.push(c);
	}
	const text = "[\n" + out.map(c => "\t" + JSON.stringify(c)).join(",\n") + "\n]\n";
	fs.writeFileSync(path.join(dir, "fixtures", f), text);
	total += out.length;
	bytes += text.length;
	console.log(`${f}: ${out.length} cases, ${out.filter(c => c.expect.length).length} with a report, ${out.filter(c => c.differs).length} that differ from ESLint, ${out.filter(c => c.eslintTest).length} of ESLint's own test, ${text.length} bytes`);
}
console.log(`total: ${total} cases, ${bytes} bytes, ${merged} cases where equal reports became one`);
