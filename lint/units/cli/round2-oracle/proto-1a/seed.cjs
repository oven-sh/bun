// Writes the first list of cases of a rule, cases/<rule>.json: the cases of the fixture in the tree in their order (with the
// kind of source that round 1 ran them as), then the cases of round 1 that one of the parsers rejects, then the cases of
// ESLint's own test that are not among them (the TypeScript ones).
// usage: node seed.cjs <rule>
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { FIXTURES, keyOf } = require("./common.cjs");
const rule = process.argv[2];
const ROUND1 = process.env.ROUND1_VECTORS || "/workspace/notes/lint/units/cli/c3-rule-support-unification/final/vectors";
const read = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : []);
const fixture = read(path.join(FIXTURES, `${rule}.json`));
const round1 = read(path.join(ROUND1, `${rule}.json`));
const upstream = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, "extract.cjs"), rule], { encoding: "utf8", maxBuffer: 1 << 28 }));
const every = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, "extract.cjs"), rule, "--all"], { encoding: "utf8", maxBuffer: 1 << 28 }));
const inUpstream = new Set(every.map(keyOf));
const typeOf = new Map(round1.map(v => [keyOf(v), v.sourceType]));
const out = [];
const seen = new Set();
const add = (c, sourceType) => {
	const key = keyOf(c);
	if (seen.has(key)) return;
	seen.add(key);
	const one = { code: c.code };
	if (c.ext) one.ext = c.ext;
	else if (c.jsx) one.jsx = true;
	if (!c.ext && sourceType) one.sourceType = sourceType;
	// A case of ESLint's own test of the rule, whatever options it has there.
	if (c.eslintTest || inUpstream.has(key) || inUpstream.has(`js:${c.code}`)) one.eslintTest = true;
	out.push(one);
};
for (const c of fixture) add(c, typeOf.get(keyOf(c)));
for (const v of round1) add(v, v.sourceType);
for (const c of [...upstream.valid, ...upstream.invalid]) add(c, c.sourceType);
fs.mkdirSync(path.join(__dirname, "cases"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "cases", `${rule}.json`), "[\n" + out.map(c => "\t" + JSON.stringify(c)).join(",\n") + "\n]\n");
console.log(`${rule}: ${out.length} cases (${fixture.length} of the fixture, ${out.filter(c => c.ext).length} with an extension, ${out.filter(c => c.eslintTest).length} of ESLint's own test)`);
