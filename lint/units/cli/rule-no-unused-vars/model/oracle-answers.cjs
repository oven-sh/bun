// Prints what ESLint at the pin answers for each case of a list, as a lint run is configured (eslint-side.cjs):
// a JavaScript file by the core rule, a TypeScript file by the rule of typescript-eslint.
// usage: node oracle-answers.cjs <cases.json>...
"use strict";
const fs = require("fs");
const side = require("/workspace/notes/lint/units/cli/ts-entry-codes-harness/topdown/tools/eslint-side.cjs");
for (const file of process.argv.slice(2)) {
	for (const raw of JSON.parse(fs.readFileSync(file, "utf8"))) {
		const c = typeof raw === "string" ? { code: raw } : raw;
		const ext = c.ext || (c.jsx ? "jsx" : "js");
		const r = side.verify(c.code, ext, ["no-unused-vars"], { plugin: side.isTs(ext), sourceType: side.sourceTypeOf(ext) });
		console.log(`[${ext}] ${JSON.stringify(c.code)}`);
		if (r.fatal) console.log(`    FATAL ${r.fatal.message}`);
		for (const m of r.messages) console.log(`    ${m.line}:${m.column} ${m.message}`);
	}
}
