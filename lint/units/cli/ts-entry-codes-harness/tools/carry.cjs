// SCRATCH of the research unit "ts-entry-codes-harness" (bottom-up). Which extension carries a case whose own source type is
// `script`, when no file of `bun --lint` is a script (.cjs and .cts are commonjs, every other file a module):
// (1) the cases of ESLint's own tests of the recommended rules that state `script`, (2) the `.js` and `.jsx` cases of the fixtures
// of the tree. Needs no build of bun.   usage: node carry.cjs [--show]
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const P = "/workspace/notes/lint/units/cli/round2-oracle/proto-1b";
const { verify, isTs } = require(path.join(P, "eslint-side.cjs"));
const rules = require(path.join(P, "recommended.cjs"));
const show = process.argv.includes("--show");
const key = r => (r.fatal ? null : r.messages.map(m => `${m.line}:${m.column} ${m.message}`).sort().join(" | "));
const tally = { script: 0, "as .js (module)": 0, "as .cjs (commonjs)": 0, "no extension": 0 };
const perRule = {};
for (const rule of rules) {
	let out;
	try {
		out = JSON.parse(execFileSync(process.execPath, [path.join(P, "extract.cjs"), rule], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] }));
	} catch {
		continue;
	}
	for (const c of out.cases) {
		if (c.sourceType !== "script" || isTs(c.ext)) continue;
		const own = key(verify(c.code, c.ext, [rule], "script"));
		if (own === null) continue;
		tally.script += 1;
		let kind;
		if (key(verify(c.code, c.ext, [rule], "module")) === own) kind = "as .js (module)";
		else if (key(verify(c.code, c.ext === "jsx" ? "jsx" : "cjs", [rule], "commonjs")) === own) kind = "as .cjs (commonjs)";
		else kind = "no extension";
		tally[kind] += 1;
		if (kind !== "as .js (module)") {
			(perRule[rule] ||= {})[kind] = ((perRule[rule] || {})[kind] || 0) + 1;
			if (show && kind === "no extension") console.log(`   ${rule}: ${JSON.stringify(c.code)}  script: ${own || "(none)"}`);
		}
	}
}
console.log("ESLint's own cases that state script:", JSON.stringify(tally));
console.log(JSON.stringify(perRule));
const dir = "/workspace/wt/cli/test/cli/lint/rules";
const fx = { cases: 0, module: 0, "commonjs only": 0, "script only": 0, rejected: 0 };
for (const f of fs.readdirSync(dir).sort()) {
	const rule = f.slice(0, -5);
	for (const c of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) {
		fx.cases += 1;
		const ext = c.ext || (c.jsx ? "jsx" : "js");
		if (!verify(c.code, ext, [rule], "module").fatal) fx.module += 1;
		else if (!verify(c.code, ext, [rule], "commonjs").fatal) {
			fx["commonjs only"] += 1;
			if (show) console.log(`   fixture ${rule} [${ext}]: ${JSON.stringify(c.code)}`);
		} else if (!verify(c.code, ext, [rule], "script").fatal) fx["script only"] += 1;
		else fx.rejected += 1;
	}
}
console.log("the cases of the fixtures by the first source type that ESLint's parser takes:", JSON.stringify(fx));
