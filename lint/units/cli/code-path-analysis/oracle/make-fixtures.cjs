// Writes fixtures in the form of tests/fixtures/code-path-analysis for shapes where Bun's tree is not ESTree and that
// upstream's 243 fixtures do not hold. The `/*expected` blocks are what ESLint at the pin answers (debug.makeDotArrows
// at onCodePathEnd, as its own test reads them).
// usage: node make-fixtures.cjs <cases.json> <out dir>    cases: [{ name, code, options? }]
"use strict";
const fs = require("fs");
const path = require("path");
const R = "/workspace/ref/eslint";
const { Linter } = require(path.join(R, "lib/linter"));
const debug = require(path.join(R, "lib/linter/code-path-analysis/debug-helpers"));
const linter = new Linter();
const [casesFile, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
let n = 0;
for (const c of JSON.parse(fs.readFileSync(casesFile, "utf8"))) {
	const actual = [];
	const jsx = c.name.endsWith(".jsx");
	const options = c.options || (jsx ? { parserOptions: { ecmaFeatures: { jsx: true } } } : null);
	const messages = linter.verify(c.code, {
		plugins: { t: { rules: { r: { create: () => ({ onCodePathEnd(codePath) { actual.push(debug.makeDotArrows(codePath)); } }) } } } },
		rules: { "t/r": 2 },
		languageOptions: options || {},
	});
	if (messages.length) {
		console.log("REJECTED", c.name, messages[0].message);
		continue;
	}
	let text = "";
	if (options) text += `/*languageOptions\n    ${JSON.stringify(options)}\n*/\n`;
	for (const a of actual) text += `/*expected\n${a}\n*/\n`;
	text += `${c.code}\n`;
	fs.writeFileSync(path.join(outDir, c.name), text);
	n++;
}
console.log("written", n);
