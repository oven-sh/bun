// Research scratch. Which cases of the given lists the debug build of the worktree rejects, and what its rules say today.
// usage: node bun-parse.cjs <list.json>...     (JavaScript cases only; a case with `ext` keeps its extension)
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const bun = "/workspace/wt/cli/build/debug/bun-debug";
for (const f of process.argv.slice(2)) {
	const parsed = JSON.parse(fs.readFileSync(f, "utf8"));
	const cases = (Array.isArray(parsed) ? parsed : [...parsed.valid, ...parsed.invalid]).map(c => (typeof c === "string" ? { code: c } : c)).filter(c => !(c.languageOptions && c.languageOptions.globals));
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rx-parse-"));
	const names = cases.map((c, i) => `c${String(i).padStart(4, "0")}.${c.ext || (c.jsx || (c.languageOptions && c.languageOptions.parserOptions) ? "jsx" : "js")}`);
	cases.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
	const lines = [];
	for (let from = 0; from < names.length; from += 200) {
		const run = spawnSync(bun, ["--lint", ...names.slice(from, from + 200)], { cwd: dir, env: { ...process.env, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" }, encoding: "utf8", maxBuffer: 1 << 28 });
		lines.push(...run.stderr.split("\n").filter(Boolean));
	}
	fs.rmSync(dir, { recursive: true, force: true });
	const tally = {};
	const rejected = [];
	for (const line of lines) {
		const m = /^(c\d+)\.\w+\((\d+),(\d+)\): (\w+) ([\w-]+): (.*)$/.exec(line);
		if (!m) { console.log("??", line); continue; }
		tally[`${m[4]} ${m[5]}`] = (tally[`${m[4]} ${m[5]}`] || 0) + 1;
		if (m[5] === "syntax" && m[4] === "error") rejected.push(`${JSON.stringify(cases[Number(m[1].slice(1))].code)}: ${m[6]}`);
	}
	console.log(path.basename(f), cases.length, JSON.stringify(tally));
	for (const r of rejected) console.log("   rejected", r.slice(0, 200));
}
