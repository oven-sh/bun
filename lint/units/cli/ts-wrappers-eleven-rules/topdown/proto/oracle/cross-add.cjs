// SCRATCH of the research unit "ts-wrappers-eleven-rules": what test/cli/lint/rules.test.ts asks of the fixtures across rules.
// A case of the fixture of rule A that gets a line of rule B has to be a case of the fixture of B too (the test of B checks
// that line). Runs the probe over every case of the planned fixtures (../../fixtures) and writes the cases that the fixture
// of another rule lacks to ../cases/<rule>.ts3.json (they are then given to diff.cjs with the other lists).
// usage: node cross-add.cjs        exit code 1 when a list was written or grew
"use strict";
const fs = require("fs");
const path = require("path");
const { bunLint, keyOf } = require("./common.cjs");
const dir = path.join(__dirname, "../../fixtures");
const rules = fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
const fixtures = Object.fromEntries(rules.map(r => [r, JSON.parse(fs.readFileSync(path.join(dir, `${r}.json`), "utf8"))]));
const keys = Object.fromEntries(rules.map(r => [r, new Set(fixtures[r].map(keyOf))]));
const cases = [];
const seen = new Set();
for (const r of rules)
	for (const c of fixtures[r]) {
		const one = { code: c.code };
		if (c.ext) one.ext = c.ext;
		else if (c.jsx) one.jsx = true;
		if (seen.has(keyOf(one))) continue;
		seen.add(keyOf(one));
		cases.push(one);
	}
(async () => {
	const ours = await bunLint(cases);
	const add = Object.fromEntries(rules.map(r => [r, []]));
	let other = 0;
	cases.forEach((c, i) => {
		for (const l of ours[i]) {
			if (rules.includes(l.code)) {
				if (!keys[l.code].has(keyOf(c)) && !add[l.code].some(x => keyOf(x) === keyOf(c))) add[l.code].push(c);
			} else if (!(l.category === "warning" && l.code === "syntax")) {
				other++;
				console.log(`a line of no rule: ${keyOf(c)} ${l.category} ${l.code} ${l.message}`);
			}
		}
	});
	let grew = false;
	for (const r of rules) {
		if (!add[r].length) continue;
		const file = path.join(__dirname, `../cases/${r}.ts3.json`);
		const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
		const all = [...old];
		for (const c of add[r]) if (!all.some(x => keyOf(x) === keyOf(c))) all.push(c);
		if (all.length !== old.length) grew = true;
		fs.writeFileSync(file, "[\n" + all.map(c => "\t" + JSON.stringify(c)).join(",\n") + "\n]\n");
		console.log(`${r}: ${add[r].length} cases of other fixtures get a line of it (${add[r].filter(c => !c.ext).length} of them JavaScript)`);
	}
	console.log(JSON.stringify({ cases: cases.length, other, grew }));
	process.exit(grew ? 1 : 0);
})().catch(err => {
	console.error(String(err && err.stack ? err.stack : err));
	process.exit(2);
});
