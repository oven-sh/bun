// Research scratch: what `bun --lint` of a build prints for each case of an answers file of eslint.cjs.
// usage: node bun.cjs <bun-debug> <answers.jsonl> [--all]   one JSON line per case that has a line (every case with --all):
// { i, code, ext, lines: ["line,col: category code: text"] }. One run of the binary over one file per case.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const [bun, answers] = process.argv.slice(2);
const all = process.argv.includes("--all");
const cases = fs.readFileSync(answers, "utf8").trim().split("\n").map(l => JSON.parse(l));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-src-"));
const ext = c => (c.type === "ts" ? "ts" : c.type === "tsx" ? "tsx" : c.jsx ? "jsx" : "js");
const names = cases.map((c, i) => `c${String(i).padStart(4, "0")}.${ext(c)}`);
cases.forEach((c, i) => fs.writeFileSync(path.join(dir, names[i]), c.code));
const r = spawnSync(bun, ["--lint", ...names], {
	cwd: dir,
	env: { ...process.env, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1", BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" },
	encoding: "utf8",
	maxBuffer: 1 << 28,
});
const lines = cases.map(() => []);
const other = [];
for (const line of r.stderr.split("\n").filter(Boolean)) {
	const m = /^c(\d+)\.\w+\((\d+),(\d+)\): (.*)$/.exec(line);
	if (m) lines[Number(m[1])].push(`${m[2]},${m[3]}: ${m[4]}`);
	else other.push(line);
}
cases.forEach((c, i) => {
	if (all || lines[i].length) console.log(JSON.stringify({ i, code: c.code, ext: ext(c), eslint: c.reports, lines: lines[i] }));
});
console.error(`exit ${r.status} signal ${r.signal} stdout ${JSON.stringify(r.stdout.slice(0, 200))} other ${JSON.stringify(other.slice(0, 5))}`);
fs.rmSync(dir, { recursive: true, force: true });
