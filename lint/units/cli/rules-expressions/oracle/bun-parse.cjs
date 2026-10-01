// Research scratch: which cases of a list Bun's parser rejects, and what the rules of the build report on them.
// usage: node bun-parse.cjs <answers.jsonl | cases.json> [--ts] [--bun <bun-debug>]   one run of `bun --lint`, files c0000.js ...
// Prints the cases with a syntax error, and per rule how many lines the build wrote (rules that exist report on the new cases too).
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const args = process.argv.slice(2);
const file = args[0];
const ts = args.includes("--ts");
const bun = args.includes("--bun") ? args[args.indexOf("--bun") + 1] : "/workspace/wt/cli/build/debug/bun-debug";
const text = fs.readFileSync(file, "utf8");
let cases;
if (file.endsWith(".jsonl")) cases = text.split("\n").filter(Boolean).map(l => JSON.parse(l));
else {
	const parsed = JSON.parse(text);
	cases = (Array.isArray(parsed) ? parsed : [...parsed.valid, ...parsed.invalid]).map(c => (typeof c === "string" ? { code: c } : c));
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bun-parse-"));
const ext = c => (ts ? (c.code.startsWith("//tsx\n") ? "tsx" : "ts") : c.jsx ? "jsx" : "js");
const names = cases.map((c, i) => `c${String(i).padStart(4, "0")}.${ext(c)}`);
cases.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
const byName = new Map(names.map((n, i) => [n, i]));
const rejected = new Map();
const rules = {};
for (let from = 0; from < names.length; from += 300) {
	const run = spawnSync(bun, ["--lint", ...names.slice(from, from + 300)], {
		cwd: dir,
		env: { ...process.env, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1", ASAN_OPTIONS: "detect_leaks=0:allow_user_segv_handler=1" },
		encoding: "utf8",
		maxBuffer: 1 << 28,
	});
	if (run.error) throw run.error;
	if (run.status !== 0 && run.status !== 2) console.log(`exit ${run.status} signal ${run.signal}: ${run.stderr.slice(0, 500)}`);
	for (const line of run.stderr.split("\n")) {
		const m = /^(c\d+\.[jt]sx?)\((\d+),(\d+)\): (\w+) ([\w-]+): (.*)$/.exec(line);
		if (!m) continue;
		const index = byName.get(m[1]);
		if (index === undefined) continue;
		if ((m[5] === "syntax" || /^TS\d+$/.test(m[5])) && m[4] === "error") {
			if (!rejected.has(index)) rejected.set(index, `${m[2]}:${m[3]} ${m[6]}`);
		} else rules[m[5]] = (rules[m[5]] || 0) + 1;
	}
}
fs.rmSync(dir, { recursive: true, force: true });
for (const [i, why] of rejected) console.log(`REJECTED ${JSON.stringify(cases[i].code)}  ${why}${cases[i].fatal ? "  (ESLint too: " + cases[i].fatal + ")" : ""}`);
console.log(`${cases.length} cases, ${rejected.size} that Bun's parser rejects; lines of the rules of the build: ${JSON.stringify(rules)}`);
