// Research scratch: the cases of upstream.cjs in the form that ../../rules-statements/oracle/make-fixture.cjs reads as ESLint's own:
// { valid, invalid } of { code, languageOptions? }. Every case of the file is kept, whatever options it was written with: the
// fixture holds what the rule says with its DEFAULT options, which make-fixture.cjs asks ESLint for. Left out: a case that
// runs with another parser (TypeScript), which goes to a TypeScript list.
// usage: node extract.cjs <rule>   reads ../cases/upstream-<rule>.json
"use strict";
const path = require("path");
const rule = process.argv[2];
const cases = require(path.join(__dirname, "..", "cases", `upstream-${rule}.json`));
const out = { valid: [], invalid: [], typescript: [] };
const seen = new Set();
for (const c of cases) {
	if (c.parser) {
		out.typescript.push({ code: c.code });
		continue;
	}
	const lo = c.languageOptions ? { ...c.languageOptions } : undefined;
	// The edition of a case is no demand: every case is read as the latest.
	if (lo) delete lo.ecmaVersion;
	const jsx = !!(lo && lo.parserOptions && lo.parserOptions.ecmaFeatures && lo.parserOptions.ecmaFeatures.jsx);
	const key = `${jsx}:${c.code}`;
	if (seen.has(key)) continue;
	seen.add(key);
	out[c.kind].push(lo && Object.keys(lo).length ? { code: c.code, languageOptions: lo } : { code: c.code });
}
process.stdout.write(JSON.stringify(out, null, "\t") + "\n");
