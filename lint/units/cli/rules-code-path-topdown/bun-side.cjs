// What the debug build of the worktree prints for the cases of one or more lists: one file per case, one run for all.
// usage: /workspace/tools/lk node bun-side.cjs <out.jsonl> <cases.json>...     (BUN=/workspace/wt/cli/build/debug/bun-debug)
// out: one JSON line per case: { list, code, ext, lines: ["(line,col): category code: text", ...] }
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const BUN = process.env.BUN || "/workspace/wt/cli/build/debug/bun-debug";
const [out, ...lists] = process.argv.slice(2);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rcp-bun-"));
const cases = [];
for (const list of lists) {
	const raw = JSON.parse(fs.readFileSync(list, "utf8"));
	for (const c0 of Array.isArray(raw) ? raw : raw.cases) {
		const c = typeof c0 === "string" ? { code: c0 } : c0;
		const ext = c.ext || (c.jsx ? "jsx" : "js");
		const name = `c${String(cases.length).padStart(5, "0")}.${ext}`;
		fs.writeFileSync(path.join(dir, name), c.code);
		cases.push({ list: path.basename(list), code: c.code, ext, name, lines: [] });
	}
}
const byName = new Map(cases.map(c => [c.name, c]));
const r = spawnSync(BUN, ["--lint", ...cases.map(c => c.name)], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" } });
for (const line of r.stderr.split("\n")) {
	const m = /^(c\d+\.\w+)(\(\d+,\d+\): .*)$/.exec(line);
	if (m && byName.has(m[1])) byName.get(m[1]).lines.push(m[2]);
	else if (line.trim()) console.log("?", line.slice(0, 200));
}
fs.writeFileSync(out, cases.map(c => JSON.stringify({ list: c.list, code: c.code, ext: c.ext, lines: c.lines })).join("\n") + "\n");
const tally = {};
for (const c of cases) {
	const k = c.list;
	tally[k] = tally[k] || { cases: 0, syntax: 0, otherRules: 0 };
	tally[k].cases++;
	if (c.lines.some(l => / error syntax: /.test(l) || / error TS\d+: /.test(l))) tally[k].syntax++;
	else if (c.lines.some(l => !/ warning /.test(l))) tally[k].otherRules++;
}
console.log(JSON.stringify({ exit: r.status, signal: r.signal, tally }, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
