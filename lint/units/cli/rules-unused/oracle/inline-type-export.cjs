// Research scratch of "rules-unused": what no-unused-vars would add when the names with `type` inside the braces of a local
// export clause are not seen (the lint tree has no item for them). usage: node inline-type-export.cjs <file.ts>...
// Per file: the reports of @typescript-eslint/no-unused-vars on the text with those names blanked that the text as written has not.
"use strict";
const fs = require("fs");
const side = require("../../ts-entry-codes-harness/topdown/tools/eslint-side.cjs");
let files = 0, withExtra = 0, extra = 0;
for (const file of process.argv.slice(2)) {
	const code = fs.readFileSync(file, "utf8");
	const ext = file.endsWith(".tsx") ? "tsx" : "ts";
	const blanked = code.replace(/export\s*\{[^}]*\}(?!\s*from)/g, clause => clause.replace(/\btype\s+[A-Za-z_$][\w$]*(\s+as\s+[A-Za-z_$][\w$]*)?\s*,?/g, m => " ".repeat(m.length)));
	if (blanked === code) continue;
	const a = side.verify(code, ext, ["no-unused-vars"], { plugin: true });
	const b = side.verify(blanked, ext, ["no-unused-vars"], { plugin: true });
	if (a.fatal || b.fatal) continue;
	files++;
	const key = m => `${m.line}:${m.column} ${m.message}`;
	const have = new Set(a.messages.map(key));
	const added = b.messages.map(key).filter(k => !have.has(k));
	if (added.length) { withExtra++; extra += added.length; console.log(file + "\n   " + added.join("\n   ")); }
}
console.log(JSON.stringify({ filesWithInlineTypeExport: files, filesWithExtra: withExtra, extraReports: extra }));
