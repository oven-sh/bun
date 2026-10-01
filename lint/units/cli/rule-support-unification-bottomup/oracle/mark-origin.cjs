// Sets "eslintTest": true on the vectors whose code is a case of ESLint's own test of the rule.
// usage: node mark-origin.cjs <vectors.json> <codes.json>
"use strict";
const fs = require("fs");
const vectors = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const codes = new Set(JSON.parse(fs.readFileSync(process.argv[3], "utf8")));
let marked = 0;
for (const v of vectors) {
	if (codes.has(v.code)) {
		v.eslintTest = true;
		marked += 1;
	}
}
fs.writeFileSync(process.argv[2], JSON.stringify(vectors, null, "\t") + "\n");
console.log(`${process.argv[2]}: ${vectors.length} vectors, ${marked} are cases of ESLint's own test`);
