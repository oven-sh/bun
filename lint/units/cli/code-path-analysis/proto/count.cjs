// How much the analysis makes of one file: code paths, segments, the largest path, events. The driver alone, no rule.
// usage: node count.cjs <file.js>
"use strict";
const fs = require("fs");
const espree = require("/workspace/ref/eslint/node_modules/espree");
const bunshape = require("./bunshape.cjs");
const { Driver } = require("./driver.cjs");
const file = process.argv[2];
const source = fs.readFileSync(file, "utf8");
let ast;
for (const sourceType of ["module", "commonjs", "script"]) {
	try {
		ast = espree.parse(source, { ecmaVersion: "latest", sourceType, range: true });
		break;
	} catch (e) {
		ast = null;
	}
}
let paths = 0, events = 0, loops = 0, segments = 0, largest = 0, nodes = 0, maxDepth = 0, depth = 0, maxCurrent = 0;
const t0 = process.hrtime.bigint();
const emit = (name, [a]) => {
	events++;
	if (name === "onCodePathStart") { paths++; depth++; if (depth > maxDepth) maxDepth = depth; }
	else if (name === "onCodePathSegmentLoop") loops++;
	else if (name === "onCodePathEnd") {
		depth--;
		const n = Number(/_(\d+)$/u.exec(a.internal.idGenerator.next())[1]) - 1;
		segments += n;
		if (n > largest) largest = n;
	}
};
const driver = new Driver(emit, () => { nodes++; });
driver.program(bunshape.program(ast));
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(JSON.stringify({ file, bytes: source.length, paths, segments, largestPath: largest, events, loops, enterLeaveCalls: nodes, nestedPathsDepth: maxDepth, driverMs: Math.round(ms) }));
