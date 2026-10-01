// Research scratch: how many reports ESLint's getter-return makes over a corpus (to size the comparisons of gr-model.cjs).
"use strict";
const fs = require("fs");
const { verify } = require("../round2-oracle/proto-1b/eslint-side.cjs");
let reports = 0, withReports = 0, n = 0;
for (const c of JSON.parse(fs.readFileSync(process.argv[2], "utf8"))) {
	const ext = c.kind === "ts" ? (c.jsx ? "tsx" : "ts") : "js";
	const r = verify(c.code, ext, ["getter-return"]);
	if (r.fatal) continue;
	n++;
	if (r.messages.length) { withReports++; reports += r.messages.length; }
}
console.log(JSON.stringify({ linted: n, sourcesWithReports: withReports, reports }));
