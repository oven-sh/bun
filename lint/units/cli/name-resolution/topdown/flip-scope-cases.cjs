// Research tool of "name-resolution" (top-down pass). Lists the cases of the fixtures of use-isnan and valid-typeof
// whose answer depends on scopes (`differs` is "missing" or "extra"), and checks that the `eslint` field of each is
// what ESLint at the pin reports with sourceType "module" (the source type that a `.js` file gets).
// usage: node flip-scope-cases.cjs [worktree]      (default /workspace/wt/cli; writes nothing)
"use strict";
const fs = require("fs");
const path = require("path");
const WT = process.argv[2] || "/workspace/wt/cli";
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
let same = 0;
let other = 0;
for (const rule of ["use-isnan", "valid-typeof"]) {
	const cases = JSON.parse(fs.readFileSync(path.join(WT, "test/cli/lint/rules", `${rule}.json`), "utf8"));
	cases.forEach((c, index) => {
		if (c.differs !== "missing" && c.differs !== "extra") return;
		const config = [
			{
				files: ["**/*.js", "**/*.jsx"],
				languageOptions: { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: !!c.jsx } } },
				linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
				rules: { [rule]: "error" },
			},
		];
		const got = linter
			.verify(c.code, config, { filename: c.jsx ? "c.jsx" : "c.js" })
			.map(m => (m.fatal ? { fatal: m.message } : { line: m.line, column: m.column, message: m.message }));
		const equal = JSON.stringify(got) === JSON.stringify(c.eslint);
		if (equal) same++;
		else other++;
		console.log(`${rule}[${index}] ${c.differs} ${equal ? "eslint-field-holds" : "ESLINT-FIELD-DIFFERS"} ${JSON.stringify(c.code)}`);
	});
}
console.log(`cases whose expect becomes their eslint field: ${same}; cases to look at: ${other}`);
