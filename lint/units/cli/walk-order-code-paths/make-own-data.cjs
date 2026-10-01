// Research scratch: the own cases in the form of code-path-analysis.txt. The expected arrows are ESLint's (oracle.cjs),
// the calls are those of the probe, and both are checked against each other here with upstream's CodePathState.
// usage: node make-own-data.cjs /tmp/wocp/q/own.json >> code-path-analysis.txt
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { replayAll } = require("./replay.cjs");
const { oracle } = require("./oracle.cjs");
const names = ["remove-missing-1", "remove-missing-2", "remove-missing-3", "finally-in-finally", "finally-leaving-paths", "continue-outer-label", "try-catch-return", "finally-break-continue"];
const cases = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "own-"));
cases.forEach((c, i) => fs.writeFileSync(path.join(tmp, `c${i}.cjs`), c.code + "\n"));
const run = spawnSync("/tmp/wocp/cpaprobe", cases.map((c, i) => `c${i}.cjs`), { cwd: tmp, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0:allow_user_segv_handler=1" }, encoding: "utf8" });
const ops = new Map();
let name = null;
for (const line of run.stdout.split("\n")) {
	if (line.startsWith("== ")) { name = line.slice(3); ops.set(name, []); } else if (line !== "") ops.get(name).push(line);
}
const replayed = replayAll(run.stdout);
const out = [];
let bad = 0;
cases.forEach((c, i) => {
	const es = oracle(c.code, { sourceType: "script" });
	const got = replayed.get(`c${i}.cjs`);
	if (es.error || !got.arrows || JSON.stringify(got.arrows) !== JSON.stringify(es.arrows)) bad++;
	out.push(`== own--${names[i]}.js`);
	for (const line of c.code.split("\n")) out.push(`| ${line}`);
	for (const block of es.arrows) { for (const line of block.split("\n")) out.push(`> ${line}`); out.push(">>"); }
	for (const op of ops.get(`c${i}.cjs`)) out.push(op);
});
fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write(out.join("\n") + "\n");
process.stderr.write(`own cases ${cases.length}, traces that do not give ESLint's arrows ${bad}\n`);
