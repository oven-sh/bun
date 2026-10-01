// Runs the eleven rules of ESLint at the pin and the probe over real files and compares every report.
// usage: node corpus.cjs [--probe path] [--eslint dir] <list of paths, one per line>
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const args = process.argv.slice(2);
let probe = "/tmp/rsu/out/lintprobe";
let eslintDir = "/tmp/cmp-probe/eslint-pin";
let listFile = null;
while (args.length) {
	const a = args.shift();
	if (a === "--probe") probe = args.shift();
	else if (a === "--eslint") eslintDir = args.shift();
	else listFile = a;
}
const RULES = ["no-debugger", "no-dupe-keys", "no-dupe-class-members", "no-duplicate-case", "no-empty-pattern", "no-compare-neg-zero", "use-isnan", "valid-typeof", "no-unsafe-negation", "no-sparse-arrays", "no-self-assign"];
const { Linter } = require(path.join(eslintDir, "lib/linter"));
const linter = new Linter({ configType: "flat" });
const files = fs.readFileSync(listFile, "utf8").split("\n").filter(Boolean);
const raw = execFileSync(probe, ["@" + listFile], { encoding: "utf8", maxBuffer: 1 << 30, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" } });
const bun = new Map();
for (const line of raw.split("\n")) {
	if (!line) continue;
	const p = line.split("\t");
	if (!bun.has(p[0])) bun.set(p[0], { parse: null, reports: [] });
	if (p.length === 2) bun.get(p[0]).parse = p[1];
	else bun.get(p[0]).reports.push(`${p[3]} ${p[4]} ${p[5]}`);
}
const tally = { files: 0, same: 0, differ: 0, "eslint-rejects": 0, "bun-rejects": 0, eslintReports: 0, bunReports: 0 };
const perRule = {};
for (const f of files) {
	const code = fs.readFileSync(f, "utf8");
	let messages = null;
	for (const [sourceType, jsx] of [["commonjs", false], ["module", false], ["commonjs", true], ["module", true], ["script", false]]) {
		const m = linter.verify(code, [{ languageOptions: { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } }, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: Object.fromEntries(RULES.map(r => [r, "error"])) }]);
		if (!m.some(x => x.fatal)) {
			messages = m;
			break;
		}
	}
	const b = bun.get(f) || { parse: "NONE", reports: [] };
	tally.files += 1;
	if (messages === null) {
		tally["eslint-rejects"] += 1;
		continue;
	}
	if (b.parse !== "OK") {
		tally["bun-rejects"] += 1;
		console.log(`bun-rejects ${f}`);
		continue;
	}
	// A message without a rule is ESLint speaking about a directive comment.
	messages = messages.filter(m => m.ruleId !== null);
	const theirs = messages.map(m => `${m.line}:${m.column} ${m.ruleId} ${m.message}`).sort();
	const ours = b.reports.slice().sort();
	tally.eslintReports += theirs.length;
	tally.bunReports += ours.length;
	for (const m of messages) perRule[m.ruleId] = (perRule[m.ruleId] || 0) + 1;
	if (JSON.stringify(theirs) === JSON.stringify(ours)) tally.same += 1;
	else {
		tally.differ += 1;
		const onlyTheirs = theirs.filter(x => !ours.includes(x));
		const onlyOurs = ours.filter(x => !theirs.includes(x));
		console.log(`differ ${f}\n  only eslint (${onlyTheirs.length}): ${onlyTheirs.slice(0, 6).join(" | ")}\n  only bun (${onlyOurs.length}): ${onlyOurs.slice(0, 6).join(" | ")}`);
	}
}
console.log(JSON.stringify(tally), JSON.stringify(perRule));
