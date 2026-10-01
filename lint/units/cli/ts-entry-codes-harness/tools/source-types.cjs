// SCRATCH of the research unit "ts-entry-codes-harness". For every rule of eslint:recommended at the pin: the cases of ESLint's
// own test that run with the default options (extract.cjs of ../../round2-oracle/proto-1b), by the source type they state,
// and for the ones that state `script` or `commonjs`: whether ESLint's parser takes the code as a module too, and whether
// the rule then answers the same. Needs no build of bun.
// usage: node source-types.cjs [--show]
"use strict";
const path = require("path");
const { execFileSync } = require("child_process");
const P = "/workspace/notes/lint/units/cli/round2-oracle/proto-1b";
const { verify, isTs } = require(path.join(P, "eslint-side.cjs"));
const rules = require(path.join(P, "recommended.cjs"));
const show = process.argv.includes("--show");
const total = { rules: 0, cases: 0, unstated: 0, module: 0, script: 0, commonjs: 0, ts: 0, scriptOnlySyntax: 0, scriptSameAsModule: 0, scriptDiffersFromModule: 0, commonjsOnlySyntax: 0, commonjsSameAsModule: 0, commonjsDiffersFromModule: 0, skipped: {} };
const key = ms => ms.map(m => `${m.line}:${m.column} ${m.message}`).sort().join(" | ");
for (const rule of rules) {
	let out;
	try {
		out = JSON.parse(execFileSync(process.execPath, [path.join(P, "extract.cjs"), rule], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] }));
	} catch (e) {
		console.log(`${rule}: extract failed: ${String(e.stderr || e).split("\n")[0]}`);
		continue;
	}
	total.rules += 1;
	const t = { cases: out.cases.length, unstated: 0, module: 0, script: 0, commonjs: 0, ts: 0, onlySyntax: 0, same: 0, differs: 0 };
	for (const [reason, n] of Object.entries(out.skipped)) total.skipped[reason] = (total.skipped[reason] || 0) + n;
	for (const c of out.cases) {
		if (isTs(c.ext)) t.ts += 1;
		t[c.sourceType || "unstated"] += 1;
		if (c.sourceType === "script" || c.sourceType === "commonjs") {
			if (isTs(c.ext)) continue;
			const own = verify(c.code, c.ext, [rule], c.sourceType);
			const asModule = verify(c.code, c.ext, [rule], "module");
			let kind;
			if (own.fatal) kind = "own-fatal";
			else if (asModule.fatal) kind = "onlySyntax";
			else if (key(own.messages) === key(asModule.messages)) kind = "same";
			else kind = "differs";
			if (kind === "own-fatal") continue;
			t[kind] += 1;
			total[`${c.sourceType}${kind === "onlySyntax" ? "OnlySyntax" : kind === "same" ? "SameAsModule" : "DiffersFromModule"}`] += 1;
			if (kind === "differs" && show) console.log(`   ${rule} [${c.sourceType}] ${JSON.stringify(c.code)}\n      as stated: ${key(own.messages) || "(none)"}\n      as module: ${key(asModule.messages) || "(none)"}`);
		}
	}
	total.cases += t.cases;
	for (const k of ["unstated", "module", "script", "commonjs", "ts"]) total[k] += t[k];
	console.log(`${rule}: ${t.cases} cases (unstated ${t.unstated}, module ${t.module}, script ${t.script}, commonjs ${t.commonjs}; TypeScript ${t.ts}); script/commonjs that ESLint takes only so ${t.onlySyntax}, same as module ${t.same}, another answer as module ${t.differs}`);
}
console.log(JSON.stringify(total, null, 1));
