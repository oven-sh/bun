// PROTOTYPE of research pass 1b. The body of the proposed test/cli/lint/rules.test.ts, run with node over `bun --lint`:
// the optional `ext` of a case, and the relaxed check of lines of other rules.
// usage: node simulate-test.cjs [--rules dir] [--bun path]     exit 1 when a rule fails
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const args = process.argv.slice(2);
let rulesDir = "/workspace/wt/cli/test/cli/lint/rules", bunExe = "/workspace/wt/cli/build/debug/bun-debug";
while (args.length) {
	const a = args.shift();
	if (a === "--rules") rulesDir = args.shift();
	else if (a === "--bun") bunExe = args.shift();
}
const rules = fs.readdirSync(rulesDir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
// ---- from here on the text is the one of the test, with `expect` as a comparison ----
const ruleNames = new Set(rules);
const extension = c => c.ext ?? (c.jsx ? "jsx" : "js");
let failed = 0;
for (const rule of rules) {
	const cases = JSON.parse(fs.readFileSync(path.join(rulesDir, `${rule}.json`), "utf8"));
	const names = cases.map((c, i) => `c${String(i).padStart(4, "0")}.${extension(c)}`);
	const indexOf = new Map(names.map((name, i) => [name, i]));
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lint-${rule}-`));
	cases.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
	const run = spawnSync(bunExe, ["--lint", ...names], { cwd: dir, env: { ...process.env, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1" }, encoding: "utf8", maxBuffer: 1 << 28 });
	fs.rmSync(dir, { recursive: true, force: true });
	const expected = cases.map((c, i) => c.expect.map(r => `${names[i]}(${r.line},${r.column}): error ${rule}: ${r.message.replace(/\r\n?|\n/g, " ")}`));
	const received = cases.map(() => []);
	const unexpected = [];
	const others = {};
	for (const line of run.stderr.split("\n").filter(Boolean)) {
		const [, name, category, code] = /^(c\d+\.[cm]?[jt]sx?)\(\d+,\d+\): (\w+) ([\w-]+): /.exec(line) ?? [];
		const index = indexOf.get(name);
		// A line of no case file.
		if (index === undefined) unexpected.push(line);
		else if (code === rule) received[index].push(line);
		// The cases of another rule check a line of that rule. What no rule with cases wrote fails: a syntax error, an internal error.
		else if (ruleNames.has(code)) others[code] = (others[code] || 0) + 1;
		else if (!(category === "warning" && code === "syntax")) unexpected.push(line);
	}
	const wrong = cases.map((c, i) => ({ code: c.code, expected: expected[i], received: received[i] })).filter(c => JSON.stringify(c.received) !== JSON.stringify(c.expected));
	const ok = run.stdout === "" && unexpected.length === 0 && wrong.length === 0 && run.status === 2;
	if (!ok) failed += 1;
	console.log(`${ok ? "pass" : "FAIL"} ${rule}: ${cases.length} cases, ${cases.filter(c => c.ext).length} with ext, wrong ${wrong.length}, unexpected ${unexpected.length}, exit ${run.status}; lines of other rules: ${JSON.stringify(others)}`);
	for (const w of wrong.slice(0, 3)) console.log(`    wrong: ${JSON.stringify(w)}`);
	for (const u of unexpected.slice(0, 3)) console.log(`    unexpected: ${u}`);
}
process.exit(failed ? 1 : 0);
