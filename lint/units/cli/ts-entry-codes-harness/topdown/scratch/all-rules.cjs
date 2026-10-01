"use strict";
const fs = require("fs");
const P = "/workspace/notes/lint/units/cli/round2-oracle/proto-1b";
const { verify } = require(P + "/eslint-side.cjs");
const ALL = require(P + "/recommended.cjs");
for (const file of process.argv.slice(2)) {
	const ext = file.slice(file.lastIndexOf(".") + 1);
	const r = verify(fs.readFileSync(file, "utf8"), ext, ALL, "module");
	if (r.fatal) console.log(file, "FATAL", r.fatal.message);
	for (const m of r.messages) console.log(`${file}(${m.line},${m.column}): error ${m.ruleId}: ${m.message}`);
}
