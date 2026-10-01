// ESLint at the pin over tests/fixtures/code-path-analysis: the arrows of every code path, as its own test compares them.
// usage: node dot-oracle.cjs [--json out.json]   exit 1 when a fixture differs from its /*expected blocks.
"use strict";
const fs = require("fs");
const path = require("path");
const R = "/workspace/ref/eslint";
const { Linter } = require(path.join(R, "lib/linter"));
const debug = require(path.join(R, "lib/linter/code-path-analysis/debug-helpers"));
const dir = path.join(R, "tests/fixtures/code-path-analysis");
const expectedPattern = /\/\*expected\s((?:.|[\r\n])+?)\*\//gu;
const languageOptionsPattern = /\/\*languageOptions\s((?:.|[\r\n])+?)\*\//u;
const linter = new Linter();
let bad = 0;
const out = {};
for (const file of fs.readdirSync(dir).sort()) {
	const source = fs.readFileSync(path.join(dir, file), "utf8");
	const expected = [...source.matchAll(expectedPattern)].map(m => m[1].trim().replace(/\r?\n/gu, "\n"));
	const m = languageOptionsPattern.exec(source);
	const actual = [];
	const messages = linter.verify(source, {
		plugins: { t: { rules: { r: { create: () => ({ onCodePathEnd(codePath) { actual.push(debug.makeDotArrows(codePath)); } }) } } } },
		rules: { "t/r": 2 },
		languageOptions: m ? JSON.parse(m[1]) : {},
	});
	out[file] = { expected, options: m ? JSON.parse(m[1]) : null };
	if (messages.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
		bad++;
		console.log("DIFF", file, messages.map(x => x.message));
	}
}
console.log("fixtures", Object.keys(out).length, "different", bad);
const at = process.argv.indexOf("--json");
if (at > 0) fs.writeFileSync(process.argv[at + 1], JSON.stringify(out, null, 1));
process.exit(bad ? 1 : 0);
